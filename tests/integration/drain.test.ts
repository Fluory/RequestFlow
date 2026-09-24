import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "@/config/env";
import { sendInTransaction } from "@/db/job-queue";
import { createJobQueue, installJobQueues } from "@/db/job-queue-client";
import { listAuditEvents } from "@/features/audit";
import { insertDocuments } from "@/features/documents";
import { createErpMock, MemoryMockStore, type ErpMock } from "@/features/erp-mock";
import { drainExports, getExportRecord } from "@/features/export";
import { persistExtractionRun } from "@/features/extraction";
import { syntheticExtractResponse } from "@/features/extraction/fixtures";
import { getActor, type Actor } from "@/features/identity";
import { QUEUES } from "@/features/jobs";
import { createRequest, getRequest, lockRequest, transitionRequest } from "@/features/requests";
import { approveRequest, correctField } from "@/features/review";
import { S3BlobStore } from "@/features/storage";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { buildJobDeps, drainRound, type DrainRoundOptions, type JobDeps } from "@/job-drain";
import { companyWithAdmin, createStack, type Stack } from "./helpers/stack";

// The serverless drain round (#59) – what `/api/jobs/drain` and `after()` run – against real Postgres,
// pg-boss and S3 storage. AI service and ERP are one local HTTP stub (external I/O boundary; the ERP side
// is the real mock module). Dedicated queues keep the shared queues of other runs untouched.
const TOKEN = "local-dev-only-erp-token-0123456789";
const suffix = randomUUID().slice(0, 8);
const QUEUES_UNDER_TEST = {
  process: { process: `test-drain-process-${suffix}`, dead: `test-drain-process-dead-${suffix}` },
  export: { export: `test-drain-export-${suffix}`, dead: `test-drain-export-dead-${suffix}` },
};
const ROUND: DrainRoundOptions = { processMs: 5_000, exportMs: 5_000, maintenance: true, queues: QUEUES_UNDER_TEST };

describe("serverless drain round: processing and export jobs, exactly once alongside the worker", () => {
  let stack: Stack;
  let server: Server;
  let storage: S3BlobStore;
  let tenancy: Tenancy;
  let serverlessBoss: PgBoss;
  let workerBoss: PgBoss;
  let serverless: JobDeps;
  let worker: JobDeps;
  let admin: Actor;
  let mock: ErpMock;
  const erpCalls: string[] = [];

  const requestOf = (id: string) => tenancy.withTenant(admin.companyId, (tx) => getRequest(tx, id));

  /** A NEW request with a stored mail and a processing job on the test queue – like intake. */
  async function uploaded() {
    const requestId = randomUUID();
    const documentId = randomUUID();
    const storageKey = S3BlobStore.documentKey(admin.companyId, requestId, documentId);
    await storage.put(storageKey, new TextEncoder().encode("From: einkauf@example.com\r\nSubject: Anfrage\r\n\r\nMusterbau Beispiel GmbH\r\n"), "message/rfc822");
    await tenancy.withTenant(admin.companyId, async (tx) => {
      await createRequest(tx, { id: requestId, createdBy: admin.userId });
      await insertDocuments(tx, [{ id: documentId, requestId, filename: "anfrage.eml", contentType: "message/rfc822", kind: "eml", sizeBytes: 10, sha256: "x".repeat(64), storageKey }]);
      await sendInTransaction(serverlessBoss, tx, QUEUES_UNDER_TEST.process.process, { requestId, companyId: admin.companyId }, { singletonKey: requestId });
    });
    return requestId;
  }

  /** An approved request (review module) whose export job sits on the test queue. */
  async function approved() {
    const requestId = randomUUID();
    const documentId = randomUUID();
    await tenancy.withTenant(admin.companyId, async (tx) => {
      await createRequest(tx, { id: requestId, createdBy: admin.userId, subject: "Anfrage Flansche DN 100" });
      await insertDocuments(tx, [{ id: documentId, requestId, filename: "anfrage.eml", contentType: "message/rfc822", kind: "eml", sizeBytes: 10, sha256: "x".repeat(64), storageKey: `${admin.companyId}/${requestId}/${documentId}` }]);
      const row = await transitionRequest(tx, (await lockRequest(tx, requestId))!, "processing.started", { attempts: 1 });
      await persistExtractionRun(tx, { requestId, jobId: randomUUID(), outcomes: [{ documentId, response: syntheticExtractResponse(documentId) }] });
      await transitionRequest(tx, row, "processing.succeeded");
    });
    await correctField(tenancy, admin, requestId, "company", "Musterbau Beispiel GmbH & Co. KG");
    await approveRequest({ tenancy, boss: serverlessBoss }, admin, requestId);
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, requestId]);
    await enqueueExport(requestId);
    return requestId;
  }
  const enqueueExport = (requestId: string) =>
    tenancy.withTenant(admin.companyId, (tx) => sendInTransaction(serverlessBoss, tx, QUEUES_UNDER_TEST.export.export, { requestId, companyId: admin.companyId }, { singletonKey: requestId }));
  const exportedEvents = async (id: string) =>
    (await tenancy.withTenant(admin.companyId, (tx) => listAuditEvents(tx, "request", id))).filter((event) => event.action === "request.exported");

  beforeAll(async () => {
    mock = createErpMock({ token: TOKEN, store: new MemoryMockStore() });
    // One stub for both outbound services: /v1/extract answers synthetic fields, /v1/quote-requests is the ERP mock.
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", async () => {
        const body = Buffer.concat(chunks);
        if (request.url === "/v1/extract") {
          const documentId = /name="documentId"\r\n\r\n([^\r]+)/.exec(body.toString("latin1"))?.[1] ?? "";
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(syntheticExtractResponse(documentId)));
          return;
        }
        erpCalls.push(String(request.headers["idempotency-key"] ?? ""));
        const headers = new Headers(Object.entries(request.headers).flatMap(([name, value]) => (typeof value === "string" ? [[name, value] as [string, string]] : [])));
        const answer = await mock.handle(new Request(`http://stub${request.url}`, { method: request.method, headers, body }));
        response.writeHead(answer.status, Object.fromEntries(answer.headers));
        response.end(Buffer.from(await answer.arrayBuffer()));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const stubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await installJobQueues(process.env.MIGRATION_DATABASE_URL!, [
      { name: QUEUES_UNDER_TEST.process.dead, policy: "standard" },
      { name: QUEUES_UNDER_TEST.process.process, policy: "exclusive", retryLimit: 1, retryDelay: 0, retryBackoff: false, deadLetter: QUEUES_UNDER_TEST.process.dead },
      { name: QUEUES_UNDER_TEST.export.dead, policy: "standard" },
      { name: QUEUES_UNDER_TEST.export.export, policy: "exclusive", retryLimit: 1, retryDelay: 0, retryBackoff: false, deadLetter: QUEUES_UNDER_TEST.export.dead },
    ]);
    const base = loadConfig();
    const config: AppConfig = {
      ...base,
      aiService: { baseUrl: stubUrl, token: "t".repeat(24), timeoutMs: 2_000 },
      erp: { ...base.erp, baseUrl: stubUrl, token: TOKEN, timeoutMs: 2_000 },
    };
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
    storage = new S3BlobStore(base.storage);
    // Two pg-boss clients: the serverless function and a long-running worker are separate processes.
    serverlessBoss = await createJobQueue(base.databaseUrl);
    workerBoss = await createJobQueue(base.databaseUrl);
    serverless = buildJobDeps(config, { tenancy, storage, boss: serverlessBoss });
    worker = buildJobDeps(config, { tenancy, storage, boss: workerBoss });
    admin = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
  });

  afterAll(async () => {
    await serverlessBoss.stop({ graceful: false });
    await workerBoss.stop({ graceful: false });
    storage.destroy();
    server.closeAllConnections();
    server.close();
    await stack.close();
  });

  it("one round drains a queued processing job (→ REVIEW) and a queued export job (→ EXPORTED) within its budget", async () => {
    const processed = await uploaded();
    const exported = await approved();
    const started = Date.now();

    const round = await drainRound(serverless, ROUND);

    expect(Date.now() - started).toBeLessThan(ROUND.processMs + ROUND.exportMs);
    expect(round.processing).toMatchObject({ processed: 1, failed: 0 });
    expect(round.exports).toMatchObject({ exported: 1, failed: 0 });
    expect((await requestOf(processed))?.status).toBe("REVIEW");
    expect((await requestOf(exported))?.status).toBe("EXPORTED");
  });

  it("an empty queue ends the round at once", async () => {
    const started = Date.now();

    const round = await drainRound(serverless, ROUND);

    expect(round).toEqual({ processing: { processed: 0, failed: 0, deadLettered: 0 }, exports: { exported: 0, failed: 0, deadLettered: 0 } });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("serverless drain and worker race for the same export, then a redelivery: one ERP record, one export row, one audit event", async () => {
    const requestId = await approved();

    await Promise.all([
      drainRound(serverless, ROUND),
      drainExports(worker.exports, { maxMs: 5_000, queues: QUEUES_UNDER_TEST.export }),
      drainRound(serverless, ROUND),
    ]);
    // At-least-once delivery: the same export arrives again after it succeeded.
    await enqueueExport(requestId);
    const redelivered = await drainRound(serverless, ROUND);

    expect((await requestOf(requestId))?.status).toBe("EXPORTED");
    expect(erpCalls.filter((key) => key === requestId)).toHaveLength(1);
    expect(mock.created()).toBe(2); // this request + the one from the first test
    expect(await tenancy.withTenant(admin.companyId, (tx) => getExportRecord(tx, requestId))).toMatchObject({ status: "succeeded", idempotencyKey: requestId, attempts: 1 });
    expect(await exportedEvents(requestId)).toHaveLength(1);
    expect(redelivered.exports).toMatchObject({ exported: 1, failed: 0 }); // job completed as "skipped", no ERP call
  });
});
