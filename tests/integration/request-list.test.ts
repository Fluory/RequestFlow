import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installJobQueues } from "@/db/job-queue-client";
import { sendInTransaction } from "@/db/job-queue";
import { listAuditEvents } from "@/features/audit";
import { createErpMock, MemoryMockStore } from "@/features/erp-mock";
import { createErpClient, drainExports, listExportRecords } from "@/features/export";
import { persistExtractionRun } from "@/features/extraction";
import { syntheticExtractResponse } from "@/features/extraction/fixtures";
import { approveRequest, currentFieldValues } from "@/features/review";
import { getActor, type Actor } from "@/features/identity";
import { QUEUES } from "@/features/jobs";
import { countRequestsByStatus, createRequest, getRequest, listRequests, lockRequest, REQUEST_PAGE_SIZE, transitionRequest, type RequestFilter } from "@/features/requests";
import { requestRowView } from "@/app/requests/row-view";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, invitedUser, type Stack } from "./helpers/stack";

// Request list (#26): seeded states through the real repository and status machine; the reprocess
// server action runs for real – only its request context (`next/headers`) is faked.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
const { reprocessAction } = await import("@/app/requests/actions");
const { getJobClient, getRuntime } = await import("@/app/_server/runtime");

async function outcomeOf(cookie: string, requestId: string): Promise<string> {
  request.headers = new Headers({ cookie });
  const form = new FormData();
  form.set("requestId", requestId);
  try {
    await reprocessAction(form);
    return "no redirect";
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2]!;
    throw error;
  }
}

describe("request list: errors, retries, filters and reprocessing (#26)", () => {
  let stack: Stack;
  let tenancy: Tenancy;
  let clerk: Actor;
  let clerkCookie: string;
  let other: Actor;

  /** A request moved through the status machine to the wanted state. */
  async function seeded(actor: Actor, state: "NEW" | "RETRYING" | "ERROR_PROCESSING" | "ERROR_EXPORT" | "DUPLICATE") {
    const id = randomUUID();
    await tenancy.withTenant(actor.companyId, async (tx) => {
      await createRequest(tx, { id, createdBy: actor.userId, subject: `Anfrage ${state}`, possibleDuplicate: state === "DUPLICATE" });
      if (state === "NEW" || state === "DUPLICATE") return;
      let row = await transitionRequest(tx, (await lockRequest(tx, id))!, "processing.started", { attempts: 2 });
      if (state === "RETRYING") {
        await transitionRequest(tx, row, "processing.started", { errorMessage: "Der KI-Dienst ist nicht erreichbar.", nextRetryAt: new Date(Date.now() + 60_000) });
        return;
      }
      if (state === "ERROR_PROCESSING") {
        await transitionRequest(tx, row, "processing.failed", { errorStage: "processing", errorMessage: "Der KI-Dienst ist nicht erreichbar." });
        return;
      }
      row = await transitionRequest(tx, row, "processing.succeeded");
      row = await transitionRequest(tx, row, "approve");
      await transitionRequest(tx, row, "export.failed", { errorStage: "export", errorMessage: "ERP hat den Export abgelehnt (HTTP 409)." });
    });
    return id;
  }
  const statusOf = async (id: string) => (await tenancy.withTenant(clerk.companyId, (tx) => getRequest(tx, id)))?.status;
  const jobsFor = async (queue: string, id: string) =>
    (await stack.database.pool.query("select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2 and state = 'created'", [queue, id])).rows[0].n as number;

  beforeAll(async () => {
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
    const a = await companyWithAdmin(stack);
    const admin = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: a.cookie })))!;
    clerkCookie = (await invitedUser(stack, admin, "clerk")).cookie;
    clerk = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: clerkCookie })))!;
    other = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
  });

  afterAll(async () => {
    await (await getJobClient()).stop({ graceful: false });
    await getRuntime().database.pool.end();
    await stack.close();
  });

  it("lists status, attempts, readable last error with its stage and the next retry – own company only", async () => {
    const retrying = await seeded(clerk, "RETRYING");
    const failed = await seeded(clerk, "ERROR_EXPORT");
    const foreign = await seeded(other, "ERROR_PROCESSING");

    const { rows } = await tenancy.withTenant(clerk.companyId, (tx) => listRequests(tx));
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(retrying)).toMatchObject({ status: "PROCESSING", attempts: 2, errorMessage: "Der KI-Dienst ist nicht erreichbar.", nextRetryAt: expect.any(Date) });
    expect(byId.get(failed)).toMatchObject({ status: "ERROR", errorStage: "export", errorMessage: "ERP hat den Export abgelehnt (HTTP 409)." });
    expect(byId.has(foreign)).toBe(false);
  });

  it("shows an export that is retrying: APPROVED with export attempts, cause and the next retry time", async () => {
    const queues = { export: `test-list-export-${randomUUID().slice(0, 8)}`, dead: `test-list-export-dead-${randomUUID().slice(0, 8)}` };
    await installJobQueues(process.env.MIGRATION_DATABASE_URL!, [
      { name: queues.dead, policy: "standard" },
      { name: queues.export, policy: "exclusive", retryLimit: 3, retryDelay: 3600, retryBackoff: false, deadLetter: queues.dead },
    ]);
    const id = randomUUID();
    const documentId = randomUUID();
    await tenancy.withTenant(clerk.companyId, async (tx) => {
      await createRequest(tx, { id, createdBy: clerk.userId, subject: "Anfrage Export" });
      const row = await transitionRequest(tx, (await lockRequest(tx, id))!, "processing.started", { attempts: 1 });
      await persistExtractionRun(tx, { requestId: id, jobId: randomUUID(), outcomes: [{ documentId, response: syntheticExtractResponse(documentId) }] });
      await transitionRequest(tx, row, "processing.succeeded");
    });
    const boss = await getJobClient();
    await approveRequest({ tenancy, boss }, clerk, id);
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, id]);
    await tenancy.withTenant(clerk.companyId, (tx) => sendInTransaction(boss, tx, queues.export, { requestId: id, companyId: clerk.companyId }, { singletonKey: id }));
    const mock = createErpMock({ token: "e".repeat(24), store: new MemoryMockStore(), faults: ["503"] });
    const erp = createErpClient({ baseUrl: "http://erp", token: "e".repeat(24), timeoutMs: 1_000, fetch: async (input, init) => mock.handle(new Request(input, init)) });

    await drainExports({ tenancy, erp, boss, fieldValues: currentFieldValues }, { maxMs: 2_000, queues });

    const request = (await tenancy.withTenant(clerk.companyId, (tx) => getRequest(tx, id)))!;
    const record = (await tenancy.withTenant(clerk.companyId, (tx) => listExportRecords(tx, [id]))).get(id);
    const row = requestRowView(request, record);
    expect(request.status).toBe("APPROVED");
    expect(row).toMatchObject({ attempts: 1, stage: "export", error: "ERP vorübergehend nicht verfügbar (HTTP 503)." });
    expect(row.nextRetryAt!.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
  });

  it("filters by status and by possible duplicate", async () => {
    const duplicate = await seeded(clerk, "DUPLICATE");
    const failed = await seeded(clerk, "ERROR_PROCESSING");

    const { rows: errors } = await tenancy.withTenant(clerk.companyId, (tx) => listRequests(tx, { status: "ERROR" }));
    const { rows: duplicates } = await tenancy.withTenant(clerk.companyId, (tx) => listRequests(tx, { possibleDuplicate: true }));

    expect(errors.every((row) => row.status === "ERROR")).toBe(true);
    expect(errors.map((row) => row.id)).toContain(failed);
    expect(errors.map((row) => row.id)).not.toContain(duplicate);
    expect(duplicates.every((row) => row.possibleDuplicate)).toBe(true);
    expect(duplicates.map((row) => row.id)).toContain(duplicate);
  });

  it("reprocess (server action): ERROR(processing) → NEW with a new job and an audit event, in one step", async () => {
    const id = await seeded(clerk, "ERROR_PROCESSING");

    expect(await outcomeOf(clerkCookie, id)).toBe("/requests?done=reprocessed");

    expect(await statusOf(id)).toBe("NEW");
    expect(await jobsFor(QUEUES.processRequest, id)).toBe(1);
    const audit = await tenancy.withTenant(clerk.companyId, (tx) => listAuditEvents(tx, "request", id));
    expect(audit.map((event) => [event.action, event.data])).toContainEqual(["request.reprocessed", { previousError: "processing" }]);
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.processRequest, id]);
  });

  it("reprocess (server action): ERROR(export) → APPROVED with a new export job", async () => {
    const id = await seeded(clerk, "ERROR_EXPORT");

    expect(await outcomeOf(clerkCookie, id)).toBe("/requests?done=reprocessed");

    expect(await statusOf(id)).toBe("APPROVED");
    expect(await jobsFor(QUEUES.exportRequest, id)).toBe(1);
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, id]);
  });

  it("refuses reprocessing a request that is not in ERROR, a foreign one and a bad id – nothing changes", async () => {
    const fresh = await seeded(clerk, "NEW");
    const foreign = await seeded(other, "ERROR_PROCESSING");

    expect(await outcomeOf(clerkCookie, fresh)).toBe("/requests?error=refused");
    expect(await outcomeOf(clerkCookie, foreign)).toBe("/requests?error=refused");
    expect(await outcomeOf(clerkCookie, "not-a-uuid")).toBe("/requests?error=refused");
    expect(await outcomeOf("", fresh)).toBe("/login");

    expect(await statusOf(fresh)).toBe("NEW");
    expect(await jobsFor(QUEUES.processRequest, fresh)).toBe(0);
    expect((await tenancy.withTenant(other.companyId, (tx) => getRequest(tx, foreign)))?.status).toBe("ERROR");
  });
});

describe("request list: keyset paging (#48)", () => {
  let stack: Stack;
  let tenancy: Tenancy;

  const actorOf = async () => (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
  /** Creates `count` requests in ONE transaction – they share created_at (now() is the transaction start), so ties are real. */
  async function seedBatch(actor: Actor, count: number, input: { possibleDuplicate?: boolean } = {}): Promise<string[]> {
    return tenancy.withTenant(actor.companyId, async (tx) => {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) ids.push((await createRequest(tx, { createdBy: actor.userId, subject: `Seite ${i}`, ...input })).id);
      return ids;
    });
  }
  const page = (actor: Actor, filter: RequestFilter = {}, after?: string) => tenancy.withTenant(actor.companyId, (tx) => listRequests(tx, filter, { after }));
  const newestFirst = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) =>
    b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  beforeAll(() => {
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
  });
  afterAll(async () => {
    await stack.close();
  });

  it("page 1 holds the 50 newest, the cursor yields the rest – no overlap, no gap, ties broken by id", async () => {
    const actor = await actorOf();
    const older = await seedBatch(actor, 30);
    const newer = await seedBatch(actor, 30);

    const first = await page(actor);
    expect(first.rows).toHaveLength(REQUEST_PAGE_SIZE);
    expect(first.nextCursor).toBe(first.rows.at(-1)!.id);
    // All 30 of the newer batch come first, then 20 of the older batch (same created_at, id desc).
    expect(first.rows.slice(0, 30).map((row) => row.id).sort()).toEqual([...newer].sort());
    expect(first.rows[29]!.createdAt).toEqual(first.rows[0]!.createdAt);
    expect(first.rows[30]!.createdAt.getTime()).toBeLessThan(first.rows[29]!.createdAt.getTime());

    const second = await page(actor, {}, first.nextCursor!);
    expect(second.rows).toHaveLength(10);
    expect(second.nextCursor).toBeNull();
    expect([first.firstPage, second.firstPage]).toEqual([true, false]);

    const all = [...first.rows, ...second.rows];
    expect(new Set(all.map((row) => row.id)).size).toBe(60);
    expect(all.map((row) => row.id).sort()).toEqual([...older, ...newer].sort());
    expect(all).toEqual([...all].sort(newestFirst));
  });

  it("stays stable when new requests arrive between two page views", async () => {
    const actor = await actorOf();
    const seeded = [...(await seedBatch(actor, 26)), ...(await seedBatch(actor, 26))];
    const first = await page(actor);

    const arrived = await seedBatch(actor, 3);
    const second = await page(actor, {}, first.nextCursor!);

    expect(second.rows).toHaveLength(2);
    expect([...first.rows, ...second.rows].map((row) => row.id).sort()).toEqual([...seeded].sort());
    expect(second.rows.some((row) => arrived.includes(row.id))).toBe(false);
  });

  it("keeps the filter across pages", async () => {
    const actor = await actorOf();
    const plainOld = await seedBatch(actor, 5);
    const duplicates = [...(await seedBatch(actor, 30, { possibleDuplicate: true })), ...(await seedBatch(actor, 22, { possibleDuplicate: true }))];
    const plainNew = await seedBatch(actor, 5);

    const first = await page(actor, { possibleDuplicate: true });
    const second = await page(actor, { possibleDuplicate: true }, first.nextCursor!);

    expect(first.rows).toHaveLength(50);
    expect(second.rows).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    expect(ids.sort()).toEqual([...duplicates].sort());
    expect(ids.some((id) => plainOld.includes(id) || plainNew.includes(id))).toBe(false);
  });

  it("never shows another company's requests – not even with that company's id as cursor", async () => {
    const actor = await actorOf();
    const other = await actorOf();
    const own = await seedBatch(actor, 55);
    const foreign = await seedBatch(other, 55);

    const first = await page(actor);
    const second = await page(actor, {}, first.nextCursor!);
    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    expect(ids.sort()).toEqual([...own].sort());
    expect(ids.some((id) => foreign.includes(id))).toBe(false);

    // A foreign row as cursor is unknown inside this tenant → first page, nothing foreign leaks.
    const probed = await page(actor, {}, foreign[0]);
    expect(probed.rows.map((row) => row.id)).toEqual(first.rows.map((row) => row.id));
  });

  it("counts the company's requests per status beyond one page (start page) – own company only", async () => {
    const actor = await actorOf();
    const other = await actorOf();
    await seedBatch(actor, 53);
    await seedBatch(other, 4);
    await tenancy.withTenant(actor.companyId, async (tx) => {
      const id = (await createRequest(tx, { createdBy: actor.userId })).id;
      await transitionRequest(tx, (await lockRequest(tx, id))!, "processing.started");
    });

    const counts = await tenancy.withTenant(actor.companyId, (tx) => countRequestsByStatus(tx));

    expect(counts).toEqual({ NEW: 53, PROCESSING: 1 });
  });

  it("falls back to the first page for a malformed or unknown cursor", async () => {
    const actor = await actorOf();
    await seedBatch(actor, 3);
    const first = await page(actor);

    for (const cursor of ["nonsense", "", "' or 1=1 --", randomUUID()]) {
      const result = await page(actor, {}, cursor);
      expect(result.rows.map((row) => row.id)).toEqual(first.rows.map((row) => row.id));
      expect(result.nextCursor).toBeNull();
      expect(result.firstPage).toBe(true);
    }
  });
});
