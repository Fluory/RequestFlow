import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { createJobQueue } from "@/db/job-queue-client";
import { listAuditEvents } from "@/features/audit";
import { insertDocuments } from "@/features/documents";
import { createErpMock, MemoryMockStore } from "@/features/erp-mock";
import { createErpClient, exportRequestJob } from "@/features/export";
import { persistExtractionRun } from "@/features/extraction";
import { syntheticExtractResponse } from "@/features/extraction/fixtures";
import { getActor, type Actor } from "@/features/identity";
import { processRequestJob, QUEUES, reprocessRequest, ReprocessRefused } from "@/features/jobs";
import { latestRun } from "@/features/extraction";
import { createRequest, getRequest, lockRequest, transitionRequest } from "@/features/requests";
import { approveRequest, confirmNotDuplicate, currentFieldValues, currentLineItemValues, rejectAsDuplicate, ReviewRefused } from "@/features/review";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, invitedUser, type Stack } from "./helpers/stack";

// Duplicate handling (#27): a flagged request is decided by a clerk – continue or reject as
// duplicate (reason, audit). A request rejected as duplicate can never be exported.
describe("duplicate handling", () => {
  let stack: Stack;
  let tenancy: Tenancy;
  let boss: PgBoss;
  let clerk: Actor;
  let other: Actor;

  /** An original plus a flagged duplicate of it, moved to the wanted status. */
  async function duplicatePair(actor: Actor, status: "NEW" | "PROCESSING" | "REVIEW" = "REVIEW") {
    const originalId = randomUUID();
    const duplicateId = randomUUID();
    await tenancy.withTenant(actor.companyId, async (tx) => {
      await createRequest(tx, { id: originalId, createdBy: actor.userId, subject: "Anfrage Flansche" });
      await createRequest(tx, { id: duplicateId, createdBy: actor.userId, subject: "Anfrage Flansche", possibleDuplicate: true, duplicateOfId: originalId });
      if (status === "NEW") return;
      const documentId = randomUUID();
      await insertDocuments(tx, [
        { id: documentId, requestId: duplicateId, filename: "anfrage.eml", contentType: "message/rfc822", kind: "eml", sizeBytes: 10, sha256: "x".repeat(64), storageKey: `${actor.companyId}/${duplicateId}/${documentId}` },
      ]);
      const row = await transitionRequest(tx, (await lockRequest(tx, duplicateId))!, "processing.started", { attempts: 1 });
      if (status === "PROCESSING") return;
      await persistExtractionRun(tx, { requestId: duplicateId, jobId: randomUUID(), outcomes: [{ documentId, response: syntheticExtractResponse(documentId) }] });
      await transitionRequest(tx, row, "processing.succeeded");
    });
    return { originalId, duplicateId };
  }
  const requestOf = (actor: Actor, id: string) => tenancy.withTenant(actor.companyId, (tx) => getRequest(tx, id));
  const auditOf = (actor: Actor, id: string) => tenancy.withTenant(actor.companyId, (tx) => listAuditEvents(tx, "request", id));
  const exportJobs = async (id: string) =>
    (await stack.database.pool.query("select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, id])).rows[0].n as number;

  beforeAll(async () => {
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
    boss = await createJobQueue(loadConfig().databaseUrl);
    const a = await companyWithAdmin(stack);
    const admin = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: a.cookie })))!;
    clerk = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await invitedUser(stack, admin, "clerk")).cookie })))!;
    other = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    await stack.close();
  });

  it("refuses approving an undecided possible duplicate; after 'not a duplicate' it can be approved – decision audited", async () => {
    const { originalId, duplicateId } = await duplicatePair(clerk);

    await expect(approveRequest({ tenancy, boss }, clerk, duplicateId)).rejects.toMatchObject({ code: "duplicate_undecided" });
    expect(await exportJobs(duplicateId)).toBe(0);

    await confirmNotDuplicate(tenancy, clerk, duplicateId);
    await approveRequest({ tenancy, boss }, clerk, duplicateId);

    expect(await requestOf(clerk, duplicateId)).toMatchObject({ status: "APPROVED", duplicateDecision: "distinct" });
    expect((await auditOf(clerk, duplicateId)).map((event) => [event.action, event.data])).toContainEqual(["request.duplicate_dismissed", { duplicateOf: originalId }]);
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, duplicateId]);
  });

  it("rejects as duplicate with a stored, audited reason – and such a request can never be exported", async () => {
    const { originalId, duplicateId } = await duplicatePair(clerk);

    await rejectAsDuplicate(tenancy, clerk, duplicateId, "Gleiche Anfrage wie gestern");

    expect(await requestOf(clerk, duplicateId)).toMatchObject({ status: "REJECTED", rejectionReason: "Gleiche Anfrage wie gestern", duplicateDecision: "duplicate" });
    expect((await auditOf(clerk, duplicateId)).map((event) => [event.action, event.data])).toContainEqual([
      "request.rejected",
      { reason: "Gleiche Anfrage wie gestern", duplicate: true, duplicateOf: originalId },
    ]);
    // No path to the ERP: approval, reprocess and a stray export job all refuse or skip.
    await expect(approveRequest({ tenancy, boss }, clerk, duplicateId)).rejects.toBeInstanceOf(ReviewRefused);
    await expect(reprocessRequest({ tenancy, boss }, clerk, duplicateId)).rejects.toBeInstanceOf(ReprocessRefused);
    const mock = createErpMock({ token: "t".repeat(24), store: new MemoryMockStore() });
    const erp = createErpClient({ baseUrl: "http://erp", token: "t".repeat(24), timeoutMs: 500, fetch: async (input, init) => mock.handle(new Request(input, init)) });
    expect(await exportRequestJob({ tenancy, erp, fieldValues: currentFieldValues, lineItemValues: currentLineItemValues }, { id: randomUUID(), data: { requestId: duplicateId, companyId: clerk.companyId } })).toBe("skipped");
    expect(mock.created()).toBe(0);
    expect(await exportJobs(duplicateId)).toBe(0);
  });

  it("rejects a NEW duplicate before processing; not while a worker holds it (PROCESSING)", async () => {
    const fresh = await duplicatePair(clerk, "NEW");
    const running = await duplicatePair(clerk, "PROCESSING");

    await rejectAsDuplicate(tenancy, clerk, fresh.duplicateId, "Doppelt hochgeladen");
    await expect(rejectAsDuplicate(tenancy, clerk, running.duplicateId, "Doppelt")).rejects.toBeInstanceOf(ReviewRefused);

    expect((await requestOf(clerk, fresh.duplicateId))?.status).toBe("REJECTED");
    expect((await requestOf(clerk, running.duplicateId))?.status).toBe("PROCESSING");
  });

  it("rejects from ERROR(processing) and clears the stale error; refuses ERROR(export) – that one was approved", async () => {
    const failed = await duplicatePair(clerk, "PROCESSING");
    const exported = await duplicatePair(clerk, "REVIEW");
    await tenancy.withTenant(clerk.companyId, async (tx) => {
      await transitionRequest(tx, (await lockRequest(tx, failed.duplicateId))!, "processing.failed", { errorStage: "processing", errorMessage: "Der KI-Dienst ist nicht erreichbar." });
      const approved = await transitionRequest(tx, (await lockRequest(tx, exported.duplicateId))!, "approve");
      await transitionRequest(tx, approved, "export.failed", { errorStage: "export", errorMessage: "ERP hat den Export abgelehnt (HTTP 409)." });
    });

    await rejectAsDuplicate(tenancy, clerk, failed.duplicateId, "Doppelt");
    await expect(rejectAsDuplicate(tenancy, clerk, exported.duplicateId, "Doppelt")).rejects.toBeInstanceOf(ReviewRefused);

    expect(await requestOf(clerk, failed.duplicateId)).toMatchObject({ status: "REJECTED", errorStage: null, errorMessage: null });
    expect(await requestOf(clerk, exported.duplicateId)).toMatchObject({ status: "ERROR", errorStage: "export" });
  });

  it("a job queued before the rejection finds REJECTED and skips – no AI call, no extraction run", async () => {
    const { duplicateId } = await duplicatePair(clerk, "NEW");
    await rejectAsDuplicate(tenancy, clerk, duplicateId, "Doppelt hochgeladen");
    let aiCalls = 0;
    const ai = { extract: async () => ((aiCalls += 1), Promise.reject(new Error("must not be called"))) };

    const outcome = await processRequestJob({ tenancy, ai, storage: { get: async () => new Uint8Array() } } as never, { id: randomUUID(), data: { requestId: duplicateId, companyId: clerk.companyId } });

    expect(outcome).toBe("skipped");
    expect(aiCalls).toBe(0);
    expect(await tenancy.withTenant(clerk.companyId, (tx) => latestRun(tx, duplicateId))).toBeNull();
  });

  it("refuses decisions on requests that are not flagged, already decided, or of another company; needs a reason", async () => {
    const { originalId, duplicateId } = await duplicatePair(clerk);

    await expect(confirmNotDuplicate(tenancy, clerk, originalId)).rejects.toMatchObject({ code: "not_a_possible_duplicate" });
    await expect(rejectAsDuplicate(tenancy, clerk, duplicateId, "  ")).rejects.toMatchObject({ code: "reason_missing" });
    await expect(rejectAsDuplicate(tenancy, other, duplicateId, "fremd")).rejects.toBeInstanceOf(ReviewRefused);
    await expect(confirmNotDuplicate(tenancy, other, duplicateId)).rejects.toBeInstanceOf(ReviewRefused);
    await confirmNotDuplicate(tenancy, clerk, duplicateId);
    await expect(rejectAsDuplicate(tenancy, clerk, duplicateId, "doch Duplikat")).rejects.toMatchObject({ code: "not_a_possible_duplicate" });

    expect(await requestOf(clerk, duplicateId)).toMatchObject({ status: "REVIEW", duplicateDecision: "distinct" });
  });
});
