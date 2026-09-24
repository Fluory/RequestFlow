import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { createJobQueue } from "@/db/job-queue-client";
import { listAuditEvents } from "@/features/audit";
import { insertDocuments } from "@/features/documents";
import { persistExtractionRun } from "@/features/extraction";
import { syntheticExtractResponse } from "@/features/extraction/fixtures";
import { AuthorizationError, getActor, type Actor } from "@/features/identity";
import { QUEUES } from "@/features/jobs";
import { createRequest, getRequest, lockRequest, transitionRequest } from "@/features/requests";
import { approveRequest, correctField, correctionHistory, loadReview, rejectRequest, ReviewRefused } from "@/features/review";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, invitedUser, type Stack } from "./helpers/stack";

describe("review: fields beside their source, corrections, approve or reject", () => {
  let stack: Stack;
  let tenancy: Tenancy;
  let boss: PgBoss;
  let clerk: Actor;
  let otherCompany: Actor;

  /** A request in REVIEW with a persisted extraction run (as the worker leaves it). */
  async function requestInReview(actor: Actor, overrides: Parameters<typeof syntheticExtractResponse>[1] = {}) {
    const requestId = randomUUID();
    const documentId = randomUUID();
    await tenancy.withTenant(actor.companyId, async (tx) => {
      await createRequest(tx, { id: requestId, createdBy: actor.userId });
      await insertDocuments(tx, [
        { id: documentId, requestId, filename: "anfrage.eml", contentType: "message/rfc822", kind: "eml", sizeBytes: 10, sha256: "x".repeat(64), storageKey: `${actor.companyId}/${requestId}/${documentId}` },
      ]);
      const row = await transitionRequest(tx, (await lockRequest(tx, requestId))!, "processing.started", { attempts: 1 });
      await persistExtractionRun(tx, { requestId, jobId: randomUUID(), outcomes: [{ documentId, response: syntheticExtractResponse(documentId, overrides) }] });
      await transitionRequest(tx, row, "processing.succeeded");
    });
    return { requestId, documentId };
  }
  const statusOf = async (actor: Actor, id: string) => (await tenancy.withTenant(actor.companyId, (tx) => getRequest(tx, id)))?.status;
  const auditOf = (actor: Actor, id: string) => tenancy.withTenant(actor.companyId, (tx) => listAuditEvents(tx, "request", id));

  beforeAll(async () => {
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

  it("shows every field with status and its source (mail line, quote marked)", async () => {
    const unverified = { value: "Fremdfirma AG", status: "unverified" as const, evidence: { segmentId: "s2", quote: "Fremdfirma AG" }, modelStatus: "found" as const, reason: "quote_not_in_segment" as const };
    const { requestId, documentId } = await requestInReview(clerk, { company: unverified });

    const view = await loadReview(tenancy, clerk, requestId);

    expect(view?.fields.map((field) => [field.key, field.status])).toEqual([
      ["company", "unverified"],
      ["contact_person", "found"],
      ["email", "found"],
      ["phone", "missing"],
      ["requested_delivery_date", "found"],
      ["additional_requirements", "missing"],
    ]);
    const contact = view!.fields[1]!;
    expect(contact.source).toMatchObject({ kind: "email", documentId, filename: "anfrage.eml" });
    expect(contact.source!.lines.find((line) => line.cited)).toMatchObject({ label: "Zeile 2", parts: [{ text: "Ansprechpartnerin: ", mark: false }, { text: "Erika Beispiel", mark: true }] });
  });

  it("stores a correction with old value, new value, user and time as an audit event in the same transaction", async () => {
    const { requestId } = await requestInReview(clerk);

    await correctField(tenancy, clerk, requestId, "company", "Musterbau Beispiel GmbH & Co. KG");

    const [correction] = await correctionHistory(tenancy, clerk, requestId);
    expect(correction).toMatchObject({ fieldKey: "company", oldValue: "Musterbau Beispiel GmbH", newValue: "Musterbau Beispiel GmbH & Co. KG", correctedBy: clerk.userId });
    const audit = (await auditOf(clerk, requestId)).find((event) => event.action === "field.corrected");
    expect(audit).toMatchObject({ actorUserId: clerk.userId, data: { field: "company", oldValue: "Musterbau Beispiel GmbH", newValue: "Musterbau Beispiel GmbH & Co. KG" } });
    expect(Math.abs(audit!.createdAt.getTime() - correction!.createdAt.getTime())).toBeLessThan(1000);
    const view = await loadReview(tenancy, clerk, requestId);
    expect(view!.fields[0]).toMatchObject({ value: "Musterbau Beispiel GmbH & Co. KG", extractedValue: "Musterbau Beispiel GmbH", corrected: { by: clerk.userId } });
  });

  it("shows a corrected value as corrected – never as found – and keeps the extraction status separately", async () => {
    const { requestId } = await requestInReview(clerk);
    expect((await loadReview(tenancy, clerk, requestId))!.fields[0]).toMatchObject({ status: "found", reviewStatus: "found" });

    await correctField(tenancy, clerk, requestId, "company", "Andere Firma GmbH");

    expect((await loadReview(tenancy, clerk, requestId))!.fields[0]).toMatchObject({ status: "found", reviewStatus: "corrected" });
  });

  it("writes neither correction nor audit when the correction is refused (unknown field)", async () => {
    const { requestId } = await requestInReview(clerk);

    await expect(correctField(tenancy, clerk, requestId, "iban", "x")).rejects.toBeInstanceOf(ReviewRefused);

    expect(await correctionHistory(tenancy, clerk, requestId)).toHaveLength(0);
    expect((await auditOf(clerk, requestId)).map((event) => event.action)).not.toContain("field.corrected");
  });

  it("refuses approval while a value is too long for the ERP, so the clerk can still correct it", async () => {
    const long = "L".repeat(501);
    const { requestId } = await requestInReview(clerk, { company: { value: long, status: "uncertain", evidence: null, modelStatus: "uncertain", reason: null } });

    await expect(approveRequest({ tenancy, boss }, clerk, requestId)).rejects.toMatchObject({ code: "value_too_long" });
    expect(await statusOf(clerk, requestId)).toBe("REVIEW");

    await correctField(tenancy, clerk, requestId, "company", "Musterbau Beispiel GmbH");
    await approveRequest({ tenancy, boss }, clerk, requestId);
    expect(await statusOf(clerk, requestId)).toBe("APPROVED");
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, requestId]);
  });

  it("does not block approval for a long value that is never exported (additional requirements)", async () => {
    const long = { value: "R".repeat(800), status: "uncertain" as const, evidence: null, modelStatus: "uncertain" as const, reason: null };
    const { requestId } = await requestInReview(clerk, { additional_requirements: long });

    await approveRequest({ tenancy, boss }, clerk, requestId);

    expect(await statusOf(clerk, requestId)).toBe("APPROVED");
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, requestId]);
  });

  it("shows line items with a status per field, and audits item corrections like header fields (#25)", async () => {
    const found = (value: string, segmentId: string) => ({ value, status: "found" as const, evidence: { segmentId, quote: value }, modelStatus: "found" as const, reason: null });
    const none = { value: null, status: "missing" as const, evidence: null, modelStatus: "missing" as const, reason: null };
    const unverified = { value: "99999", status: "unverified" as const, evidence: { segmentId: "s2", quote: "x" }, modelStatus: "found" as const, reason: "quote_not_in_segment" as const };
    const requestId = randomUUID();
    const documentId = randomUUID();
    await tenancy.withTenant(clerk.companyId, async (tx) => {
      await createRequest(tx, { id: requestId, createdBy: clerk.userId });
      await insertDocuments(tx, [
        { id: documentId, requestId, filename: "anfrage.eml", contentType: "message/rfc822", kind: "eml", sizeBytes: 10, sha256: "x".repeat(64), storageKey: `${clerk.companyId}/${requestId}/${documentId}` },
      ]);
      const row = await transitionRequest(tx, (await lockRequest(tx, requestId))!, "processing.started", { attempts: 1 });
      const items = [
        { index: 0, description: found("Musterbau Beispiel GmbH", "s2"), quantity: unverified, unit: none, material: none, dimensions: none },
        { index: 1, description: none, quantity: none, unit: none, material: none, dimensions: none },
      ];
      await persistExtractionRun(tx, { requestId, jobId: randomUUID(), outcomes: [{ documentId, response: syntheticExtractResponse(documentId, {}, items) }] });
      await transitionRequest(tx, row, "processing.succeeded");
    });

    const view = await loadReview(tenancy, clerk, requestId);
    expect(view?.lineItems.map((item) => [item.itemIndex, item.fields.map((field) => [field.key, field.status])])).toEqual([
      [0, [["description", "found"], ["quantity", "unverified"], ["unit", "missing"], ["material", "missing"], ["dimensions", "missing"]]],
      [1, [["description", "missing"], ["quantity", "missing"], ["unit", "missing"], ["material", "missing"], ["dimensions", "missing"]]],
    ]);
    expect(view?.lineItems[0]?.fields[0]?.source).toMatchObject({ kind: "email", documentId });

    await correctField(tenancy, clerk, requestId, "quantity", "1250", 0);

    const corrected = (await loadReview(tenancy, clerk, requestId))!.lineItems[0]!.fields.find((field) => field.key === "quantity");
    expect(corrected).toMatchObject({ value: "1250", extractedValue: "99999", reviewStatus: "corrected", itemIndex: 0 });
    // The correction belongs to position 0 only – position 1 keeps its (missing) value.
    expect((await loadReview(tenancy, clerk, requestId))!.lineItems[1]!.fields.find((field) => field.key === "quantity")?.value).toBeNull();
    expect((await auditOf(clerk, requestId)).find((event) => event.action === "field.corrected")?.data).toEqual({ field: "quantity", item: 0, oldValue: "99999", newValue: "1250" });
    await expect(correctField(tenancy, clerk, requestId, "quantity", "5", 7)).rejects.toMatchObject({ code: "unknown_field" });
    await expect(correctField(tenancy, clerk, requestId, "company", "x", 0)).rejects.toMatchObject({ code: "unknown_field" });
    await expect(correctField(tenancy, clerk, requestId, "quantity", "5")).rejects.toMatchObject({ code: "unknown_field" });

    // #47: the database itself refuses a negative position, like extracted_fields does (defence in
    // depth below correctField). Runs as the runtime role app_rw inside the tenant transaction.
    const insertCorrection = (itemIndex: number) =>
      tenancy.withTenant(clerk.companyId, (tx) =>
        tx.execute(sql`insert into app.field_corrections (company_id, request_id, field_key, item_index, new_value, corrected_by)
          values (${clerk.companyId}, ${requestId}, 'quantity', ${itemIndex}, '1', ${clerk.userId})`),
      );
    await expect(insertCorrection(-1)).rejects.toMatchObject({ cause: { code: "23514", constraint: "field_corrections_item_index_check" } });
    await expect(insertCorrection(1)).resolves.toBeDefined();
  });

  it("keeps failed attachments and skipped OCR pages per document for the review (#23)", async () => {
    const requestId = randomUUID();
    const documentId = randomUUID();
    await tenancy.withTenant(clerk.companyId, async (tx) => {
      await createRequest(tx, { id: requestId, createdBy: clerk.userId });
      await insertDocuments(tx, [
        { id: documentId, requestId, filename: "anfrage.msg", contentType: "application/vnd.ms-outlook", kind: "msg", sizeBytes: 10, sha256: "x".repeat(64), storageKey: `${clerk.companyId}/${requestId}/${documentId}` },
      ]);
      const row = await transitionRequest(tx, (await lockRequest(tx, requestId))!, "processing.started", { attempts: 1 });
      const response = {
        ...syntheticExtractResponse(documentId),
        documentKind: "msg" as const,
        warnings: ["attachment_failed" as const, "ocr_pages_skipped" as const],
        attachments: [
          { path: [0], name: "positionen.xlsx", documentKind: "xlsx" as const, status: "parsed" as const, error: null, segmentCount: 4 },
          { path: [1], name: "kaputt.pdf", documentKind: null, status: "failed" as const, error: "document_unparseable" as const, segmentCount: 0 },
        ],
      };
      await persistExtractionRun(tx, { requestId, jobId: randomUUID(), outcomes: [{ documentId, response }] });
      await transitionRequest(tx, row, "processing.succeeded");
    });

    const view = await loadReview(tenancy, clerk, requestId);

    expect(view?.documentNotes).toEqual([
      { documentId, failedAttachments: [{ name: "kaputt.pdf", error: "document_unparseable" }], warnings: ["attachment_failed", "ocr_pages_skipped"] },
    ]);
  });

  it("approve: APPROVED and the export job in one transaction, audited", async () => {
    const { requestId } = await requestInReview(clerk);

    await approveRequest({ tenancy, boss }, clerk, requestId);

    expect(await statusOf(clerk, requestId)).toBe("APPROVED");
    const jobs = await stack.database.pool.query("select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, requestId]);
    expect(jobs.rows[0].n).toBe(1);
    expect((await auditOf(clerk, requestId)).map((event) => event.action)).toContain("request.approved");
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, requestId]);
  });

  it("approve rolls back completely when the export job cannot be enqueued", async () => {
    const { requestId } = await requestInReview(clerk);
    const failing = { send: async () => null } as unknown as PgBoss; // queue policy refuses → error

    await expect(approveRequest({ tenancy, boss: failing }, clerk, requestId)).rejects.toThrow(/refused/);

    expect(await statusOf(clerk, requestId)).toBe("REVIEW");
    expect((await auditOf(clerk, requestId)).map((event) => event.action)).not.toContain("request.approved");
  });

  it("reject: REJECTED with a mandatory reason, audited", async () => {
    const { requestId } = await requestInReview(clerk);

    await expect(rejectRequest(tenancy, clerk, requestId, "   ")).rejects.toBeInstanceOf(ReviewRefused);
    await rejectRequest(tenancy, clerk, requestId, "Kein Angebot möglich – Werkstoff nicht lieferbar.");

    const request = await tenancy.withTenant(clerk.companyId, (tx) => getRequest(tx, requestId));
    expect(request).toMatchObject({ status: "REJECTED", rejectionReason: "Kein Angebot möglich – Werkstoff nicht lieferbar." });
    expect((await auditOf(clerk, requestId)).map((event) => event.action)).toContain("request.rejected");
  });

  it("only requests in REVIEW can be approved, rejected or corrected", async () => {
    const { requestId } = await requestInReview(clerk);
    await approveRequest({ tenancy, boss }, clerk, requestId);

    await expect(approveRequest({ tenancy, boss }, clerk, requestId)).rejects.toBeInstanceOf(ReviewRefused);
    await expect(rejectRequest(tenancy, clerk, requestId, "zu spät")).rejects.toBeInstanceOf(ReviewRefused);
    await expect(correctField(tenancy, clerk, requestId, "company", "x")).rejects.toBeInstanceOf(ReviewRefused);
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, requestId]);
  });

  it("another company can neither see nor change the request (RLS) and unknown roles are refused", async () => {
    const { requestId } = await requestInReview(clerk);

    expect(await loadReview(tenancy, otherCompany, requestId)).toBeNull();
    await expect(approveRequest({ tenancy, boss }, otherCompany, requestId)).rejects.toBeInstanceOf(ReviewRefused);
    await expect(rejectRequest(tenancy, otherCompany, requestId, "fremd")).rejects.toBeInstanceOf(ReviewRefused);
    await expect(correctField(tenancy, otherCompany, requestId, "company", "fremd")).rejects.toBeInstanceOf(ReviewRefused);
    await expect(correctField(tenancy, { ...clerk, role: "viewer" as never }, requestId, "company", "x")).rejects.toBeInstanceOf(AuthorizationError);
    expect(await statusOf(clerk, requestId)).toBe("REVIEW");
  });

  it("keeps corrections company-private: another company sees none and cannot write one for a foreign company (RLS)", async () => {
    const { requestId } = await requestInReview(clerk);
    await correctField(tenancy, clerk, requestId, "company", "Nur für uns GmbH");

    expect(await correctionHistory(tenancy, otherCompany, requestId)).toEqual([]);
    const client = await stack.database.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.company_id', $1, true)", [otherCompany.companyId]);
      await expect(
        client.query("insert into app.field_corrections (company_id, request_id, field_key, new_value, corrected_by) values ($1, $2, 'company', 'x', $3)", [clerk.companyId, requestId, otherCompany.userId]),
      ).rejects.toThrow(/row-level security/);
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect(await correctionHistory(tenancy, clerk, requestId)).toHaveLength(1);
  });

  it("refuses an overlong rejection reason instead of cutting it", async () => {
    const { requestId } = await requestInReview(clerk);

    await expect(rejectRequest(tenancy, clerk, requestId, "x".repeat(1001))).rejects.toMatchObject({ code: "reason_too_long" });
    expect(await statusOf(clerk, requestId)).toBe("REVIEW");
  });

  it("keeps corrections append-only for the runtime role", async () => {
    const { requestId } = await requestInReview(clerk);
    await correctField(tenancy, clerk, requestId, "company", "Neu GmbH");
    const client = await stack.database.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.company_id', $1, true)", [clerk.companyId]);
      await expect(client.query("update app.field_corrections set new_value = 'x' where request_id = $1", [requestId])).rejects.toThrow(/permission denied/);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
