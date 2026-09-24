import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { sendInTransaction } from "@/db/job-queue";
import { createJobQueue, installJobQueues } from "@/db/job-queue-client";
import { listAuditEvents } from "@/features/audit";
import { insertDocuments, listDocuments } from "@/features/documents";
import { createErpMock, MemoryMockStore, type ErpMock, type MockFault } from "@/features/erp-mock";
import { createErpClient, drainExports, exportRequestJob, getExportRecord, type ExportDrainDeps } from "@/features/export";
import { persistExtractionRun } from "@/features/extraction";
import { syntheticExtractResponse } from "@/features/extraction/fixtures";
import { getActor, type Actor } from "@/features/identity";
import { QUEUES, reprocessRequest } from "@/features/jobs";
import { createRequest, getRequest, lockRequest, transitionRequest } from "@/features/requests";
import { approveRequest, correctField, currentFieldValues, currentLineItemValues, loadReview, ReviewRefused } from "@/features/review";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, invitedUser, type Stack } from "./helpers/stack";

// Exactly-once export (ADR-0001 D9): database and pg-boss are real; the ERP is the mock module,
// reached through the adapter's injected fetch (the network boundary is the only fake). Dedicated
// queues with fast retries keep the shared export queue untouched.
const TOKEN = "local-dev-only-erp-token-0123456789";
const suffix = randomUUID().slice(0, 8);
const QUEUES_UNDER_TEST = { export: `test-export-${suffix}`, dead: `test-export-dead-${suffix}` };

describe("export: approved requests reach the ERP exactly once", () => {
  let stack: Stack;
  let tenancy: Tenancy;
  let boss: PgBoss;
  let clerk: Actor;
  let otherCompany: Actor;
  let mock: ErpMock;
  let erpCalls: string[];

  function depsWith(faults: MockFault[] = [], timeoutMs = 300): ExportDrainDeps {
    mock = createErpMock({ token: TOKEN, store: new MemoryMockStore(), faults, hangMs: 5_000 });
    erpCalls = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      erpCalls.push(request.headers.get("idempotency-key") ?? "");
      const response = await mock.handle(request);
      if (request.signal.aborted) throw request.signal.reason;
      return response;
    };
    return { tenancy, boss, erp: createErpClient({ baseUrl: "http://web/api/erp-mock", token: TOKEN, timeoutMs, fetch: fetchImpl }), fieldValues: currentFieldValues, lineItemValues: currentLineItemValues };
  }

  const found = (value: string, segmentId: string) => ({ value, status: "found", evidence: { segmentId, quote: value }, modelStatus: "found", reason: null }) as const;
  const missingValue = { value: null, status: "missing", evidence: null, modelStatus: "missing", reason: null } as const;
  /** Two synthetic positions whose quotes sit in the fixture's segments. */
  const POSITIONS = [
    { index: 0, description: found("Musterbau Beispiel GmbH", "s2"), quantity: found("15.10.2026", "s4"), unit: { ...missingValue }, material: { ...missingValue }, dimensions: { ...missingValue } },
    { index: 1, description: found("Erika Beispiel", "s3"), quantity: { ...missingValue }, unit: { ...missingValue }, material: { ...missingValue }, dimensions: { ...missingValue } },
  ];

  /** A request approved through the review module, with its export job moved to the test queue. */
  async function approved(actor: Actor, lineItems: typeof POSITIONS = [], beforeApproval: (requestId: string) => Promise<void> = async () => {}) {
    const requestId = randomUUID();
    const documentId = randomUUID();
    await tenancy.withTenant(actor.companyId, async (tx) => {
      await createRequest(tx, { id: requestId, createdBy: actor.userId, subject: "Anfrage Flansche DN 100" });
      await insertDocuments(tx, [
        { id: documentId, requestId, filename: "anfrage.eml", contentType: "message/rfc822", kind: "eml", sizeBytes: 10, sha256: "x".repeat(64), storageKey: `${actor.companyId}/${requestId}/${documentId}` },
      ]);
      const row = await transitionRequest(tx, (await lockRequest(tx, requestId))!, "processing.started", { attempts: 1 });
      await persistExtractionRun(tx, { requestId, jobId: randomUUID(), outcomes: [{ documentId, response: syntheticExtractResponse(documentId, {}, lineItems) }] });
      await transitionRequest(tx, row, "processing.succeeded");
    });
    await correctField(tenancy, actor, requestId, "company", "Musterbau Beispiel GmbH & Co. KG");
    await beforeApproval(requestId);
    await approveRequest({ tenancy, boss }, actor, requestId);
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, requestId]);
    const data = { requestId, companyId: actor.companyId };
    const jobId = await tenancy.withTenant(actor.companyId, (tx) => sendInTransaction(boss, tx, QUEUES_UNDER_TEST.export, data, { singletonKey: requestId }));
    return { requestId, job: { id: jobId, data } };
  }
  const requestOf = (actor: Actor, id: string) => tenancy.withTenant(actor.companyId, (tx) => getRequest(tx, id));
  const exportOf = (actor: Actor, id: string) => tenancy.withTenant(actor.companyId, (tx) => getExportRecord(tx, id));
  const exportedEvents = async (actor: Actor, id: string) =>
    (await tenancy.withTenant(actor.companyId, (tx) => listAuditEvents(tx, "request", id))).filter((event) => event.action === "request.exported");
  async function drainUntil(deps: ExportDrainDeps, predicate: () => Promise<boolean>, timeoutMs = 20_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await drainExports(deps, { maxMs: 2_000, queues: QUEUES_UNDER_TEST });
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("condition not reached");
  }

  beforeAll(async () => {
    await installJobQueues(process.env.MIGRATION_DATABASE_URL!, [
      { name: QUEUES_UNDER_TEST.dead, policy: "standard" },
      { name: QUEUES_UNDER_TEST.export, policy: "exclusive", retryLimit: 4, retryDelay: 0, retryBackoff: false, deadLetter: QUEUES_UNDER_TEST.dead },
    ]);
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
    boss = await createJobQueue(loadConfig().databaseUrl);
    const a = await companyWithAdmin(stack);
    const admin = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: a.cookie })))!;
    clerk = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await invitedUser(stack, admin, "clerk")).cookie })))!;
    otherCompany = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    await stack.close();
  });

  it("survives a 503, a timeout and a lost response: EXPORTED once, one ERP record, one export row, one audit event", async () => {
    const deps = depsWith(["503", "timeout", "lost"]);
    const { requestId } = await approved(clerk);

    await drainUntil(deps, async () => (await requestOf(clerk, requestId))?.status === "EXPORTED");

    expect(mock.created()).toBe(1);
    expect(erpCalls).toEqual([requestId, requestId, requestId, requestId]);
    const record = await exportOf(clerk, requestId);
    expect(record).toMatchObject({ status: "succeeded", idempotencyKey: requestId, attempts: 4, lastError: null });
    expect(record!.erpReference).toMatch(/^QR-/);
    const events = await exportedEvents(clerk, requestId);
    expect(events).toHaveLength(1);
    // The fourth call was a replay of the record the "lost" response had already created.
    expect(events[0]!.data).toMatchObject({ erpReference: record!.erpReference, replay: true });
    const rows = await stack.database.pool.query("select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2 and state = 'completed'", [QUEUES_UNDER_TEST.export, requestId]);
    expect(rows.rows[0].n).toBe(1);
  });

  it("sends the reviewed values: corrections win over the extraction", async () => {
    const deps = depsWith();
    const { requestId, job } = await approved(clerk);
    let sent: unknown;
    const erp = deps.erp;
    await exportRequestJob({ ...deps, erp: { submit: (body) => ((sent = body), erp.submit(body)) } }, job);

    expect(sent).toMatchObject({ requestId, subject: "Anfrage Flansche DN 100", fields: { company: "Musterbau Beispiel GmbH & Co. KG", contactPerson: "Erika Beispiel" } });
    expect(Date.parse((sent as { approvedAt: string }).approvedAt)).not.toBeNaN();
    // Without positions the body stays exactly what contract v1.0 sent (#46: the field is optional).
    expect(sent).not.toHaveProperty("lineItems");
  });

  it("sends the reviewed positions in document order: an item correction wins over the extraction (#46)", async () => {
    const deps = depsWith();
    const { requestId, job } = await approved(clerk, POSITIONS, (id) => correctField(tenancy, clerk, id, "quantity", "1300", 0));
    let sent: unknown;
    const erp = deps.erp;
    await exportRequestJob({ ...deps, erp: { submit: (body) => ((sent = body), erp.submit(body)) } }, job);

    expect((sent as { lineItems: unknown }).lineItems).toEqual([
      { position: 1, description: "Musterbau Beispiel GmbH", quantity: "1300", unit: null, material: null, dimensions: null },
      { position: 2, description: "Erika Beispiel", quantity: null, unit: null, material: null, dimensions: null },
    ]);
    expect((await requestOf(clerk, requestId))?.status).toBe("EXPORTED");
    expect(mock.created()).toBe(1);
  });

  it("refuses the approval while a position value would break the ERP contract (#46)", async () => {
    // Corrections are capped at 500 characters, so an overlong position value can only come from the
    // extraction; the approval must refuse it while the clerk can still correct it.
    const tooLong = [{ ...POSITIONS[0]!, description: { ...found("Musterbau Beispiel GmbH", "s2"), value: "x".repeat(501) } }];
    await expect(approved(clerk, tooLong)).rejects.toMatchObject({ code: "value_too_long" });
  });

  it("refuses more positions than the ERP accepts with its own code – a correction cannot fix that (#46 review)", async () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => ({ ...POSITIONS[1]!, index }));
    const refusal = approved(clerk, tooMany);
    await expect(refusal).rejects.toBeInstanceOf(ReviewRefused);
    await expect(refusal).rejects.toMatchObject({ code: "export_too_large" });
  });

  it("exports exactly the positions the review shows: an item correction older than the latest run is ignored (#46 review)", async () => {
    const deps = depsWith();
    const { requestId, job } = await approved(clerk, POSITIONS, async (id) => {
      await correctField(tenancy, clerk, id, "quantity", "1300", 0);
      // A newer run (as after reprocessing) makes the correction stale – positions may have shifted.
      await tenancy.withTenant(clerk.companyId, async (tx) => {
        const documentId = (await listDocuments(tx, id))[0]!.id;
        await persistExtractionRun(tx, { requestId: id, jobId: randomUUID(), outcomes: [{ documentId, response: syntheticExtractResponse(documentId, {}, POSITIONS) }] });
      });
    });
    let sent: { lineItems?: Array<Record<string, unknown>> } | undefined;
    const erp = deps.erp;
    await exportRequestJob({ ...deps, erp: { submit: (body) => ((sent = body), erp.submit(body)) } }, job);

    expect(sent?.lineItems?.[0]).toMatchObject({ position: 1, quantity: "15.10.2026" });
    const shown = (await loadReview(tenancy, clerk, requestId))!.lineItems.map((item) => Object.fromEntries(item.fields.map((field) => [field.key, field.value])));
    expect(sent?.lineItems?.map(({ position: _position, ...values }) => values)).toEqual(shown);
  });

  it("duplicate delivery of the same job: the row lock lets one export, the other sees EXPORTED and never calls the ERP", async () => {
    const deps = depsWith();
    const { requestId, job } = await approved(clerk);

    const outcomes = await Promise.all([exportRequestJob(deps, job), exportRequestJob(deps, job)]);
    const third = await exportRequestJob(deps, job);

    expect(outcomes.sort()).toEqual(["exported", "skipped"]);
    expect(third).toBe("skipped");
    expect(erpCalls).toEqual([requestId]);
    expect(mock.created()).toBe(1);
    expect(await exportedEvents(clerk, requestId)).toHaveLength(1);
  });

  it("an ERP that stored the request before our commit failed answers the retry with the same reference", async () => {
    const deps = depsWith();
    const { requestId, job } = await approved(clerk);
    const values = await tenancy.withTenant(clerk.companyId, async (tx) => {
      const { buildQuoteRequest } = await import("@/features/export");
      return buildQuoteRequest(tx, (await getRequest(tx, requestId))!, currentFieldValues, currentLineItemValues);
    });
    const first = await deps.erp.submit(values);

    expect(await exportRequestJob(deps, job)).toBe("exported");

    expect(mock.created()).toBe(1);
    expect((await exportOf(clerk, requestId))?.erpReference).toBe(first.receipt.erpReference);
  });

  it("a permanent refusal (409) ends in ERROR (stage export) at once; reprocess puts it back to APPROVED with a new job", async () => {
    const deps = depsWith();
    const { requestId, job } = await approved(clerk);
    const other = { requestId, subject: "anders", approvedAt: new Date().toISOString(), fields: { company: "X", contactPerson: null, requestedDeliveryDate: null } };
    await deps.erp.submit(other);

    await drainUntil(deps, async () => (await requestOf(clerk, requestId))?.status === "ERROR");

    expect(await requestOf(clerk, requestId)).toMatchObject({ status: "ERROR", errorStage: "export" });
    expect((await requestOf(clerk, requestId))?.errorMessage).toMatch(/ERP/);
    expect(await exportOf(clerk, requestId)).toMatchObject({ status: "pending", attempts: 1 });
    expect(erpCalls.filter((key) => key === requestId)).toHaveLength(2);
    const completed = await stack.database.pool.query("select state from pgboss.job where id = $1", [job.id]);
    expect(completed.rows[0]?.state).toBe("completed");

    await reprocessRequest({ tenancy, boss }, clerk, requestId);

    expect(await requestOf(clerk, requestId)).toMatchObject({ status: "APPROVED", errorStage: null, errorMessage: null });
    const queued = await stack.database.pool.query("select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2 and state = 'created'", [QUEUES.exportRequest, requestId]);
    expect(queued.rows[0].n).toBe(1);
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, requestId]);
  });

  it("retries exhausted: the dead letter moves the request to ERROR (stage export) with a readable cause", async () => {
    const deps = depsWith(["503", "503", "503", "503", "503", "503"]);
    const { requestId } = await approved(clerk);

    await drainUntil(deps, async () => (await requestOf(clerk, requestId))?.status === "ERROR");

    expect(await requestOf(clerk, requestId)).toMatchObject({ status: "ERROR", errorStage: "export" });
    expect(await exportOf(clerk, requestId)).toMatchObject({ status: "pending", attempts: 5 });
    expect(mock.created()).toBe(0);
  });

  it("does nothing for a request that is not APPROVED and shows the export only to its own company (RLS)", async () => {
    const deps = depsWith();
    const { requestId, job } = await approved(clerk);
    await exportRequestJob(deps, job);

    expect(await exportRequestJob(deps, { id: randomUUID(), data: { requestId: randomUUID(), companyId: clerk.companyId } })).toBe("skipped");
    expect(await exportOf(otherCompany, requestId)).toBeNull();
    expect(await exportRequestJob(deps, { id: randomUUID(), data: { requestId, companyId: otherCompany.companyId } })).toBe("skipped");
    expect(erpCalls).toEqual([requestId]);
  });
});
