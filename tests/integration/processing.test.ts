import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/config/env";
import { sendInTransaction } from "@/db/job-queue";
import { createJobQueue, installJobQueues } from "@/db/job-queue-client";
import { listAuditEvents } from "@/features/audit";
import { insertDocuments } from "@/features/documents";
import { createAiServiceClient, latestRun } from "@/features/extraction";
import { syntheticExtractResponse } from "@/features/extraction/fixtures";
import { getActor, type Actor } from "@/features/identity";
import { drain, processRequestJob, QUEUES, reprocessRequest, ReprocessRefused, type DrainDeps } from "@/features/jobs";
import { createRequest, getRequest } from "@/features/requests";
import { S3BlobStore } from "@/features/storage";
import { createTenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, type Stack } from "./helpers/stack";

// The AI service is replaced by a local HTTP stub (external I/O boundary); database, storage and
// pg-boss are real. Dedicated queues with fast retries keep the shared queue untouched.
type Reply = (documentId: string, body: string) => { status: number; body?: unknown } | "hang";
let reply: Reply = (documentId) => ({ status: 200, body: syntheticExtractResponse(documentId) });
const aiCalls: string[] = [];

const suffix = randomUUID().slice(0, 8);
const TEST_QUEUES = { process: `test-process-${suffix}`, dead: `test-process-dead-${suffix}` };

describe("processing: worker, AI service, retries and visible errors", () => {
  let stack: Stack;
  let server: Server;
  let storage: S3BlobStore;
  let boss: PgBoss;
  let deps: DrainDeps;
  let admin: Actor;
  let otherAdmin: Actor;

  const enc = (text: string) => new TextEncoder().encode(text);
  const MAIL = enc("From: Einkauf <einkauf@example.com>\r\nSubject: Anfrage\r\nMessage-ID: <p@example.com>\r\n\r\nMusterbau Beispiel GmbH\r\n");

  /** A NEW request with stored documents and a job on the test queue – like intake, but isolated. */
  async function newRequest(actor: Actor, files: Array<{ name: string; kind: "eml" | "pdf" | "xlsx"; bytes: Uint8Array }>) {
    const requestId = randomUUID();
    const documents = files.map((file) => {
      const id = randomUUID();
      return { id, requestId, filename: file.name, contentType: "application/octet-stream", kind: file.kind, sizeBytes: file.bytes.byteLength, sha256: "x".repeat(64), storageKey: S3BlobStore.documentKey(actor.companyId, requestId, id), bytes: file.bytes };
    });
    for (const document of documents) await storage.put(document.storageKey, document.bytes, document.contentType);
    const jobId = await deps.tenancy.withTenant(actor.companyId, async (tx) => {
      await createRequest(tx, { id: requestId, createdBy: actor.userId });
      await insertDocuments(tx, documents.map(({ bytes: _bytes, ...document }) => document));
      return sendInTransaction(boss, tx, TEST_QUEUES.process, { requestId, companyId: actor.companyId }, { singletonKey: requestId });
    });
    return { requestId, jobId, documentIds: documents.map((document) => document.id), job: { id: jobId, data: { requestId, companyId: actor.companyId } } };
  }
  const requestOf = (actor: Actor, id: string) => deps.tenancy.withTenant(actor.companyId, (tx) => getRequest(tx, id));
  const runOf = (actor: Actor, id: string) => deps.tenancy.withTenant(actor.companyId, (tx) => latestRun(tx, id));
  const countIn = (actor: Actor, query: SQL) =>
    deps.tenancy.withTenant(actor.companyId, async (tx) => ((await tx.execute(query)).rows[0] as { n: number }).n);
  async function drainUntil(predicate: () => Promise<boolean>, timeoutMs = 15_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await drain(deps, { maxMs: 2_000, queues: TEST_QUEUES });
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("condition not reached");
  }

  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("latin1");
        const documentId = /name="documentId"\r\n\r\n([^\r]+)/.exec(body)?.[1] ?? "";
        aiCalls.push(documentId);
        const answer = reply(documentId, body);
        if (answer === "hang") return;
        response.writeHead(answer.status, { "content-type": "application/json" });
        response.end(JSON.stringify(answer.body ?? { error: { code: "stub", message: "stub" }, requestId: null }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const config = loadConfig();
    await installJobQueues(process.env.MIGRATION_DATABASE_URL!, [
      { name: TEST_QUEUES.dead, policy: "standard" },
      { name: TEST_QUEUES.process, policy: "exclusive", retryLimit: 1, retryDelay: 0, retryBackoff: false, deadLetter: TEST_QUEUES.dead },
    ]);
    stack = createStack();
    storage = new S3BlobStore(config.storage);
    boss = await createJobQueue(config.databaseUrl);
    deps = {
      tenancy: createTenancy(stack.database.db),
      storage,
      ai: createAiServiceClient({ baseUrl, token: "t".repeat(24), timeoutMs: 1_000 }),
      boss,
    };
    admin = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
    otherAdmin = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    storage.destroy();
    server.closeAllConnections();
    server.close();
    await stack.close();
  });

  it("processes a request: run, segments and fields persisted, REVIEW, audit – in one transaction", async () => {
    reply = (documentId) => ({ status: 200, body: syntheticExtractResponse(documentId) });
    const { requestId } = await newRequest(admin, [{ name: "anfrage.eml", kind: "eml", bytes: MAIL }]);

    await drainUntil(async () => (await requestOf(admin, requestId))?.status === "REVIEW");

    const run = await runOf(admin, requestId);
    expect(run?.fields.map((field) => [field.fieldKey, field.status]).sort()).toEqual([
      ["company", "found"],
      ["contact_person", "found"],
      ["requested_delivery_date", "found"],
    ]);
    expect(run?.run).toMatchObject({ modelId: "gemini-3.5-flash", promptVersion: "extract_header_v1", schemaVersion: "1" });
    expect(await countIn(admin, sql`select count(*)::int as n from app.extraction_segments where run_id = ${run!.run.id}`)).toBe(4);
    // Forced RLS: the same query without a company context sees nothing.
    const raw = await stack.database.pool.query("select count(*)::int as n from app.extraction_segments where run_id = $1", [run!.run.id]);
    expect(raw.rows[0].n).toBe(0);
    const audit = await deps.tenancy.withTenant(admin.companyId, (tx) => listAuditEvents(tx, "request", requestId));
    expect(audit.map((event) => event.action)).toContain("request.extracted");
    expect(await requestOf(admin, requestId)).toMatchObject({ attempts: 1, errorMessage: null });
  });

  it("is idempotent: the same job delivered twice in a row yields exactly one run", async () => {
    reply = (documentId) => ({ status: 200, body: syntheticExtractResponse(documentId) });
    const { requestId, job } = await newRequest(admin, [{ name: "a.eml", kind: "eml", bytes: MAIL }]);

    const first = await processRequestJob(deps, job);
    const second = await processRequestJob(deps, job);

    expect([first, second]).toEqual(["processed", "skipped"]);
    expect((await runOf(admin, requestId))?.run.jobId).toBe(job.id);
    expect(await countIn(admin, sql`select count(*)::int as n from app.extraction_runs where request_id = ${requestId}`)).toBe(1);
  });

  it("is idempotent under concurrent duplicate delivery: one run, one REVIEW", async () => {
    reply = (documentId) => ({ status: 200, body: syntheticExtractResponse(documentId) });
    const { requestId, job } = await newRequest(admin, [{ name: "a.eml", kind: "eml", bytes: MAIL }]);

    const results = await Promise.all([processRequestJob(deps, job), processRequestJob(deps, job)]);

    expect(results.sort()).toEqual(["processed", "skipped"]);
    expect(await countIn(admin, sql`select count(*)::int as n from app.extraction_runs where request_id = ${requestId}`)).toBe(1);
    expect((await requestOf(admin, requestId))?.status).toBe("REVIEW");
  });

  it("retries an AI-service 5xx, then dead-letters and shows ERROR with a readable cause and the attempts", async () => {
    reply = () => ({ status: 503 });
    const { requestId } = await newRequest(admin, [{ name: "a.eml", kind: "eml", bytes: MAIL }]);

    await drainUntil(async () => (await requestOf(admin, requestId))?.status === "ERROR");

    const request = await requestOf(admin, requestId);
    expect(request).toMatchObject({ status: "ERROR", errorStage: "processing", errorMessage: "Der KI-Dienst ist nicht erreichbar.", attempts: 2, nextRetryAt: null });
    expect(request?.errorMessage).not.toMatch(/127\.0\.0\.1|Error|at /);
  });

  it("treats a timeout as retryable", async () => {
    reply = () => "hang";
    const { requestId, job } = await newRequest(admin, [{ name: "a.eml", kind: "eml", bytes: MAIL }]);

    await expect(processRequestJob(deps, job)).rejects.toMatchObject({ code: "timeout", retryable: true });
    expect((await requestOf(admin, requestId))?.status).toBe("PROCESSING");
  });

  it("does not retry a permanent failure (service misconfigured): ERROR at once", async () => {
    reply = () => ({ status: 401 });
    const { requestId, documentIds } = await newRequest(admin, [{ name: "a.eml", kind: "eml", bytes: MAIL }]);

    await drainUntil(async () => (await requestOf(admin, requestId))?.status === "ERROR");

    expect(aiCalls.filter((id) => id === documentIds[0])).toHaveLength(1);
    expect((await requestOf(admin, requestId))?.errorMessage).toMatch(/abgelehnt/);
  });

  it("processes the other documents when one is rejected, and skips formats the service does not read yet", async () => {
    reply = (documentId, body) => (body.includes("%PDF") ? { status: 422 } : { status: 200, body: syntheticExtractResponse(documentId) });
    const { requestId } = await newRequest(admin, [
      { name: "a.eml", kind: "eml", bytes: MAIL },
      { name: "kaputt.pdf", kind: "pdf", bytes: enc("%PDF-1.7 broken") },
      { name: "liste.xlsx", kind: "xlsx", bytes: enc("PK") },
    ]);

    await drainUntil(async () => (await requestOf(admin, requestId))?.status === "REVIEW");

    const documents = (await runOf(admin, requestId))?.run.documents as Array<{ skipped?: string }>;
    expect(documents.map((document) => document.skipped ?? "processed").sort()).toEqual(["processed", "rejected_422", "unsupported_kind"]);
  });

  it("goes to ERROR when no document can be processed at all", async () => {
    const { requestId } = await newRequest(admin, [{ name: "liste.xlsx", kind: "xlsx", bytes: enc("PK") }]);

    await drainUntil(async () => (await requestOf(admin, requestId))?.status === "ERROR");

    expect((await requestOf(admin, requestId))?.errorMessage).toBe("Kein Dokument dieser Anfrage konnte automatisch verarbeitet werden.");
  });

  it("reprocess re-enqueues an ERROR request in the same transaction and is audited; other companies cannot", async () => {
    reply = () => ({ status: 401 });
    const { requestId } = await newRequest(admin, [{ name: "a.eml", kind: "eml", bytes: MAIL }]);
    await drainUntil(async () => (await requestOf(admin, requestId))?.status === "ERROR");

    await expect(reprocessRequest({ tenancy: deps.tenancy, boss }, otherAdmin, requestId)).rejects.toBeInstanceOf(ReprocessRefused);
    await reprocessRequest({ tenancy: deps.tenancy, boss }, admin, requestId);

    expect(await requestOf(admin, requestId)).toMatchObject({ status: "NEW", errorMessage: null });
    const jobs = await stack.database.pool.query("select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.processRequest, requestId]);
    expect(jobs.rows[0].n).toBe(1);
    const audit = await deps.tenancy.withTenant(admin.companyId, (tx) => listAuditEvents(tx, "request", requestId));
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining(["request.failed", "request.reprocessed"]));
  });

  it("logs IDs only – no document content, no e-mail addresses", async () => {
    reply = (documentId) => ({ status: 200, body: syntheticExtractResponse(documentId) });
    const lines: string[] = [];
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error")].map((spy) =>
      spy.mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" "))),
    );
    try {
      const { requestId } = await newRequest(admin, [{ name: "a.eml", kind: "eml", bytes: MAIL }]);
      await drainUntil(async () => (await requestOf(admin, requestId))?.status === "REVIEW");

      expect(lines.some((line) => line.includes(requestId))).toBe(true);
      expect(lines.join("\n")).not.toMatch(/Musterbau|Erika|example\.com|15\.10\.2026/);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
