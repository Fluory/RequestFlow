import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PgBoss } from "pg-boss";
import { loadConfig } from "@/config/env";
import { listAuditEvents } from "@/features/audit";
import { listDocuments } from "@/features/documents";
import { getActor, type Actor } from "@/features/identity";
import { submitUpload, UploadRateLimited, UploadRejected, type IntakeDeps } from "@/features/intake";
import { createJobQueue } from "@/db/job-queue-client";
import { QUEUES } from "@/features/jobs";
import { getRequest } from "@/features/requests";
import { S3BlobStore } from "@/features/storage";
import { createTenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, invitedUser, unique, type Stack } from "./helpers/stack";

const enc = (text: string) => new TextEncoder().encode(text);
const mail = (messageId: string) =>
  enc(`From: Einkauf <einkauf@example.com>\r\nTo: vertrieb@example.org\r\nSubject: Anfrage Flansche\r\nMessage-ID: ${messageId}\r\n\r\nBitte um Angebot.\r\n`);
const pdf = (marker: string) => enc(`%PDF-1.7\n% synthetic ${marker}\n`);

describe("intake: upload a request and enqueue processing atomically", () => {
  let stack: Stack;
  let storage: S3BlobStore;
  let boss: PgBoss;
  let deps: IntakeDeps;
  let clerkA: Actor;
  let adminB: Actor;

  const jobCount = async (requestId: string) => {
    const { rows } = await stack.database.pool.query(
      "select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2",
      [QUEUES.processRequest, requestId],
    );
    return rows[0].n as number;
  };
  const requestExists = async (actor: Actor, id: string) =>
    (await deps.tenancy.withTenant(actor.companyId, (tx) => getRequest(tx, id))) !== null;
  const objectExists = (key: string) => storage.get(key).then(() => true, () => false);

  beforeAll(async () => {
    stack = createStack();
    const config = loadConfig();
    storage = new S3BlobStore(config.storage);
    boss = await createJobQueue(config.databaseUrl);
    deps = { tenancy: createTenancy(stack.database.db), storage, boss, limits: { maxFileBytes: 1024 * 1024, maxFiles: 5 } };

    const a = await companyWithAdmin(stack);
    const adminA = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: a.cookie })))!;
    const clerk = await invitedUser(stack, adminA, "clerk");
    clerkA = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: clerk.cookie })))!;
    const b = await companyWithAdmin(stack);
    adminB = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: b.cookie })))!;
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    storage.destroy();
    await stack.close();
  });

  it("commits request (NEW), documents, audit event and one job together; originals are stored privately", async () => {
    const result = await submitUpload(deps, clerkA, [
      { name: "anfrage.eml", bytes: mail(`<${unique("m")}@example.com>`) },
      { name: "zeichnung.pdf", bytes: pdf(unique("p")) },
    ]);

    const { request, documents, audit } = await deps.tenancy.withTenant(clerkA.companyId, async (tx) => ({
      request: await getRequest(tx, result.requestId),
      documents: await listDocuments(tx, result.requestId),
      audit: await listAuditEvents(tx, "request", result.requestId),
    }));
    expect(request).toMatchObject({ status: "NEW", companyId: clerkA.companyId, createdBy: clerkA.userId, subject: "Anfrage Flansche" });
    expect(documents.map((d) => d.kind).sort()).toEqual(["eml", "pdf"]);
    for (const document of documents) {
      expect(document.storageKey).toBe(`${clerkA.companyId}/${result.requestId}/${document.id}`);
      expect(await objectExists(document.storageKey)).toBe(true);
      expect(document.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "request.uploaded", actorUserId: clerkA.userId });
    expect(await jobCount(result.requestId)).toBe(1);
  });

  it("rolls back request, documents and job when a failure happens after the inserts, and removes the stored objects", async () => {
    let requestId = "";
    let jobsInsideTransaction = -1;
    const keys: string[] = [];
    const failingBoss: Pick<PgBoss, "send"> = {
      send: (async (...args: Parameters<PgBoss["send"]>) => {
        const [, data, options] = args as [string, { requestId: string }, { db: { executeSql(t: string, v: unknown[]): Promise<{ rows: Array<{ n: number }> }> } }];
        requestId = data.requestId;
        await (boss.send as (...a: unknown[]) => Promise<unknown>)(...args); // the job row is really inserted …
        const seen = await options.db.executeSql("select count(*)::int as n from pgboss.job where singleton_key = $1", [requestId]);
        jobsInsideTransaction = seen.rows[0]!.n; // … visible inside the transaction …
        throw new Error("injected failure after the job insert"); // … and then the transaction fails
      }) as unknown as PgBoss["send"],
    };
    const put = storage.put.bind(storage);
    const spyStorage = Object.assign(Object.create(storage) as S3BlobStore, {
      put: async (key: string, bytes: Uint8Array, type: string) => {
        keys.push(key);
        return put(key, bytes, type);
      },
    });

    await expect(
      submitUpload({ ...deps, boss: failingBoss, storage: spyStorage }, clerkA, [{ name: "anfrage.pdf", bytes: pdf(unique("fail")) }]),
    ).rejects.toThrow(/injected failure/);

    expect(requestId).not.toBe("");
    expect(jobsInsideTransaction).toBe(1);
    expect(await requestExists(clerkA, requestId)).toBe(false);
    const audit = await deps.tenancy.withTenant(clerkA.companyId, (tx) => listAuditEvents(tx, "request", requestId));
    expect(audit).toHaveLength(0);
    expect(await jobCount(requestId)).toBe(0);
    const documents = await deps.tenancy.withTenant(clerkA.companyId, (tx) => listDocuments(tx, requestId));
    expect(documents).toHaveLength(0);
    expect(keys).toHaveLength(1);
    expect(await objectExists(keys[0]!)).toBe(false);
  });

  it("flags a second upload with the same Message-ID as a possible duplicate of the first", async () => {
    const messageId = `<${unique("dup")}@example.com>`;
    const first = await submitUpload(deps, clerkA, [{ name: "a.eml", bytes: mail(messageId) }]);

    const second = await submitUpload(deps, clerkA, [
      { name: "b.eml", bytes: enc(`Subject: Re: Anfrage\r\nMessage-ID: ${messageId}\r\nFrom: x@example.com\r\n\r\nanderer Text`) },
    ]);

    expect(first.possibleDuplicate).toBe(false);
    expect(second).toMatchObject({ possibleDuplicate: true, duplicateOfId: first.requestId });
  });

  it("keeps a subject taken from a long file name within the ERP limit of 300 characters (file names are capped at 200)", async () => {
    const name = `${"a".repeat(400)}.pdf`;
    const result = await submitUpload(deps, clerkA, [{ name, bytes: pdf(unique("long")) }]);

    const request = await deps.tenancy.withTenant(clerkA.companyId, (tx) => getRequest(tx, result.requestId));
    expect(request?.subject).toBe(name.slice(-200));
  });

  it("flags the same set of files as a possible duplicate, in any order", async () => {
    const one = pdf(unique("x"));
    const two = pdf(unique("y"));
    const first = await submitUpload(deps, clerkA, [
      { name: "1.pdf", bytes: one },
      { name: "2.pdf", bytes: two },
    ]);

    const second = await submitUpload(deps, clerkA, [
      { name: "zwei.pdf", bytes: two },
      { name: "eins.pdf", bytes: one },
    ]);

    expect(second).toMatchObject({ possibleDuplicate: true, duplicateOfId: first.requestId });
  });

  it("detects duplicates only within the same company", async () => {
    const bytes = pdf(unique("shared"));
    await submitUpload(deps, clerkA, [{ name: "a.pdf", bytes }]);

    const other = await submitUpload(deps, adminB, [{ name: "a.pdf", bytes }]);

    expect(other.possibleDuplicate).toBe(false);
  });

  it("rejects a disallowed type with a clear message and stores nothing", async () => {
    await expect(submitUpload(deps, clerkA, [{ name: "makro.xlsm", bytes: new Uint8Array([0x50, 0x4b, 3, 4]) }])).rejects.toThrow(
      UploadRejected,
    );
  });

  it("keeps the audit trail append-only for the runtime role", async () => {
    const result = await submitUpload(deps, clerkA, [{ name: "a.pdf", bytes: pdf(unique("audit")) }]);
    const client = await stack.database.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.company_id', $1, true)", [clerkA.companyId]);
      await expect(client.query("update app.audit_events set action = 'x' where entity_id = $1", [result.requestId])).rejects.toThrow(
        /permission denied/,
      );
      await client.query("rollback");
      await client.query("begin");
      await client.query("select set_config('app.company_id', $1, true)", [clerkA.companyId]);
      await expect(client.query("delete from app.audit_events where entity_id = $1", [result.requestId])).rejects.toThrow(/permission denied/);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("does not let a company attach a document to another company's request (composite FK)", async () => {
    const foreign = await submitUpload(deps, adminB, [{ name: "b.pdf", bytes: pdf(unique("b")) }]);
    const client = await stack.database.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.company_id', $1, true)", [clerkA.companyId]);
      const insert = client.query(
        `insert into app.documents (company_id, request_id, filename, content_type, kind, size_bytes, sha256, storage_key)
         values ($1, $2, 'x.pdf', 'application/pdf', 'pdf', 1, 'x', 'x')`,
        [clerkA.companyId, foreign.requestId],
      );
      await expect(insert).rejects.toThrow(/foreign key/);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
  it("caps uploads per person and hour when a limit is set, before anything is stored (#59 review)", async () => {
    const clerk = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await invitedUser(stack, adminB, "clerk")).cookie })))!;
    const limited = { ...deps, limits: { ...deps.limits, maxPerHour: 2 } };
    await submitUpload(limited, clerk, [{ name: "a.pdf", bytes: pdf(unique("rate-1")) }]);
    await submitUpload(limited, clerk, [{ name: "b.pdf", bytes: pdf(unique("rate-2")) }]);

    const keys: string[] = [];
    const spyStorage = Object.assign(Object.create(storage) as S3BlobStore, {
      put: async (key: string, ...rest: unknown[]) => {
        keys.push(key);
        return (storage.put as (...args: unknown[]) => Promise<void>)(key, ...rest);
      },
    });
    const third = submitUpload({ ...limited, storage: spyStorage }, clerk, [{ name: "c.pdf", bytes: pdf(unique("rate-3")) }]);
    await expect(third).rejects.toBeInstanceOf(UploadRateLimited);
    expect(keys).toEqual([]);

    // Per person: another clerk of the same company still uploads; without a limit nobody is capped.
    const colleague = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await invitedUser(stack, adminB, "clerk")).cookie })))!;
    await expect(submitUpload(limited, colleague, [{ name: "d.pdf", bytes: pdf(unique("rate-4")) }])).resolves.toMatchObject({ requestId: expect.any(String) });
    await expect(submitUpload(deps, clerk, [{ name: "e.pdf", bytes: pdf(unique("rate-5")) }])).resolves.toMatchObject({ requestId: expect.any(String) });
  });
});
