import { and, asc, eq } from "drizzle-orm";
import { fieldCorrections } from "@/db/schema";
import { recordAudit } from "@/features/audit";
import { listDocuments, type DocumentRow } from "@/features/documents";
import { exportLimitViolations, getExportRecord, type ExportRecord } from "@/features/export";
import { HEADER_FIELDS, ITEM_FIELDS, latestRun, listSegments } from "@/features/extraction";
import { authorize, type Actor } from "@/features/identity";
import { enqueueRequestExport, type JobSender } from "@/features/jobs";
import { getRequest, lockRequest, transitionRequest, type RequestRow } from "@/features/requests";
import { tenantOf, type Tenancy, type TenantTx } from "@/features/tenancy";
import { buildSourceView, type SourceView, type StoredSegment } from "./source-view";

export const FIELD_LABELS: Record<string, string> = {
  company: "Firma",
  contact_person: "Ansprechpartner:in",
  email: "E-Mail",
  phone: "Telefon",
  requested_delivery_date: "Gewünschter Liefertermin",
  additional_requirements: "Zusätzliche Anforderungen",
  // Line-item fields (#25).
  description: "Beschreibung",
  quantity: "Menge",
  unit: "Einheit",
  material: "Werkstoff",
  dimensions: "Abmessungen",
};

export type FieldStatus = "found" | "uncertain" | "missing" | "unverified";
/** What the clerk sees: a corrected value is never shown as "found" – its proof is the correction history. */
export type ReviewStatus = FieldStatus | "corrected";

export const REJECTION_REASON_MAX = 1000;

export interface ReviewField {
  key: string;
  /** Line item position (#25); null for header fields. */
  itemIndex: number | null;
  label: string;
  /** Current value: the latest correction, else the extracted value. */
  value: string | null;
  extractedValue: string | null;
  /** Status of the extracted value (grounding verifier). */
  status: FieldStatus;
  reviewStatus: ReviewStatus;
  reason: string | null;
  corrected: { by: string; at: Date } | null;
  source: (SourceView & { documentId: string; filename: string }) | null;
}

export interface ReviewLineItem {
  itemIndex: number;
  fields: ReviewField[];
}

export interface ReviewView {
  request: RequestRow;
  fields: ReviewField[];
  /** Line items (#25), in run order; each item field with its own status, source and corrections. */
  lineItems: ReviewLineItem[];
  documents: DocumentRow[];
  skippedDocuments: Array<{ documentId: string; reason: string }>;
  /** Per document: attachments of an Outlook message that could not be read (#23), and warnings. */
  documentNotes: Array<{ documentId: string; failedAttachments: Array<{ name: string | null; error: string | null }>; warnings: string[] }>;
  /** Export state (#9): reference once exported, attempts and last error while retrying. */
  exportRecord: ExportRecord | null;
}

export type ReviewRefusal = "not_in_review" | "unknown_field" | "reason_missing" | "reason_too_long" | "value_too_long";

/** Refused action: request missing (or of another company – RLS), not in REVIEW, or invalid input. */
export class ReviewRefused extends Error {
  constructor(readonly code: ReviewRefusal = "not_in_review") {
    super(`review refused: ${code}`);
    this.name = "ReviewRefused";
  }
}

/** Corrections are per field and – for line items – per position (#25). */
const correctionKey = (fieldKey: string, itemIndex: number | null) => (itemIndex === null ? fieldKey : `${fieldKey}#${itemIndex}`);

async function currentCorrections(tx: TenantTx, requestId: string) {
  tenantOf(tx);
  const rows = await tx.select().from(fieldCorrections).where(eq(fieldCorrections.requestId, requestId)).orderBy(asc(fieldCorrections.createdAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latest.set(correctionKey(row.fieldKey, row.itemIndex), row);
  return latest;
}

/**
 * The reviewed value of every header field: the latest correction, else the extracted value. Runs in
 * the caller's tenant transaction (the export reads it under the request's row lock, #9).
 */
export async function currentFieldValues(tx: TenantTx, requestId: string): Promise<Record<string, string | null>> {
  const corrections = await currentCorrections(tx, requestId);
  const extraction = await latestRun(tx, requestId);
  return Object.fromEntries(
    HEADER_FIELDS.map((key) => {
      const correction = corrections.get(correctionKey(key, null));
      return [key, correction ? correction.newValue : (extraction?.fields.find((field) => field.fieldKey === key)?.value ?? null)];
    }),
  );
}

export async function loadReview(tenancy: Tenancy, actor: Actor, requestId: string): Promise<ReviewView | null> {
  authorize(actor, "requests.process");
  return tenancy.withTenant(actor.companyId, async (tx) => {
    const request = await getRequest(tx, requestId);
    if (!request) return null;
    const documents = await listDocuments(tx, requestId);
    const exportRecord = await getExportRecord(tx, requestId);
    const extraction = await latestRun(tx, requestId);
    if (!extraction) return { request, fields: [], lineItems: [], documents, skippedDocuments: [], documentNotes: [], exportRecord };
    const segments = await listSegments(tx, extraction.run.id);
    const corrections = await currentCorrections(tx, requestId);
    type FieldRow = (typeof extraction.fields)[number];
    const toReviewField = (key: string, itemIndex: number | null, field: FieldRow | undefined): ReviewField => {
      const stored = corrections.get(correctionKey(key, itemIndex));
      // Item positions belong to one run: a correction made before a newer run is not mapped onto it.
      const correction = itemIndex !== null && stored && stored.createdAt < extraction.run.createdAt ? undefined : stored;
      const documentSegments = segments.filter((segment) => segment.documentId === field?.documentId) as Array<StoredSegment & { documentId: string }>;
      const view = field?.segmentId && field.quote ? buildSourceView(documentSegments, { segmentId: field.segmentId, quote: field.quote }) : null;
      const document = documents.find((candidate) => candidate.id === field?.documentId);
      return {
        key,
        itemIndex,
        label: FIELD_LABELS[key] ?? key,
        value: correction ? correction.newValue : (field?.value ?? null),
        extractedValue: field?.value ?? null,
        status: (field?.status ?? "missing") as FieldStatus,
        reviewStatus: correction ? "corrected" : ((field?.status ?? "missing") as FieldStatus),
        reason: field?.reason ?? null,
        corrected: correction ? { by: correction.correctedBy, at: correction.createdAt } : null,
        source: view && document ? { ...view, documentId: document.id, filename: document.filename } : null,
      };
    };
    const byKey = new Map(extraction.fields.map((field) => [field.fieldKey, field]));
    const fields = HEADER_FIELDS.map((key) => toReviewField(key, null, byKey.get(key)));
    const lineItems = extraction.lineItems.map((item) => {
      const itemFields = new Map(item.fields.map((field) => [field.fieldKey, field]));
      return { itemIndex: item.itemIndex, fields: ITEM_FIELDS.map((key) => toReviewField(key, item.itemIndex, itemFields.get(key))) };
    });
    const skippedDocuments = (extraction.run.documents as Array<{ documentId: string; skipped?: string }>)
      .filter((entry) => entry.skipped)
      .map((entry) => ({ documentId: entry.documentId, reason: entry.skipped! }));
    const documentNotes = (extraction.run.documents as Array<{ documentId: string; failedAttachments?: Array<{ name: string | null; error: string | null }>; warnings?: string[] }>).map(
      (entry) => ({ documentId: entry.documentId, failedAttachments: entry.failedAttachments ?? [], warnings: entry.warnings ?? [] }),
    );
    return { request, fields, lineItems, documents, skippedDocuments, documentNotes, exportRecord };
  });
}

async function lockForReview(tx: TenantTx, requestId: string): Promise<RequestRow> {
  const request = await lockRequest(tx, requestId);
  if (!request || request.status !== "REVIEW") throw new ReviewRefused();
  return request;
}

/**
 * Stores a correction and its audit event (old value, new value, user, time) in ONE transaction – for a
 * header field, or with `itemIndex` for a field of an existing line item (#25).
 */
export async function correctField(
  tenancy: Tenancy,
  actor: Actor,
  requestId: string,
  fieldKey: string,
  newValue: string | null,
  itemIndex: number | null = null,
): Promise<void> {
  authorize(actor, "requests.process");
  const known = itemIndex === null ? (HEADER_FIELDS as readonly string[]) : (ITEM_FIELDS as readonly string[]);
  if (!known.includes(fieldKey) || (itemIndex !== null && (!Number.isInteger(itemIndex) || itemIndex < 0))) throw new ReviewRefused("unknown_field");
  const value = newValue === null ? null : newValue.trim().slice(0, 500) || null;
  await tenancy.withTenant(actor.companyId, async (tx) => {
    await lockForReview(tx, requestId);
    const run = await latestRun(tx, requestId);
    const rows = itemIndex === null ? run?.fields : run?.lineItems.find((item) => item.itemIndex === itemIndex)?.fields;
    if (itemIndex !== null && !rows) throw new ReviewRefused("unknown_field");
    const previous = (await currentCorrections(tx, requestId)).get(correctionKey(fieldKey, itemIndex));
    const extracted = rows?.find((field) => field.fieldKey === fieldKey);
    const oldValue = previous ? previous.newValue : (extracted?.value ?? null);
    if (oldValue === value) return;
    await tx.insert(fieldCorrections).values({ companyId: actor.companyId, requestId, fieldKey, itemIndex, oldValue, newValue: value, correctedBy: actor.userId });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: "field.corrected",
      entityType: "request",
      entityId: requestId,
      data: itemIndex === null ? { field: fieldKey, oldValue, newValue: value } : { field: fieldKey, item: itemIndex, oldValue, newValue: value },
    });
  });
}

/**
 * REVIEW → APPROVED and the export job in ONE transaction (ADR-0001 D9), audited. Refused while a
 * value would break the ERP contract – otherwise the export could never succeed and, after approval,
 * the value can no longer be corrected.
 */
export async function approveRequest(deps: { tenancy: Tenancy; boss: JobSender }, actor: Actor, requestId: string): Promise<void> {
  authorize(actor, "requests.process");
  await deps.tenancy.withTenant(actor.companyId, async (tx) => {
    const request = await lockForReview(tx, requestId);
    if (exportLimitViolations(request.subject, await currentFieldValues(tx, requestId)).length > 0) throw new ReviewRefused("value_too_long");
    await transitionRequest(tx, request, "approve");
    await enqueueRequestExport(deps.boss, tx, requestId);
    await recordAudit(tx, { actorUserId: actor.userId, action: "request.approved", entityType: "request", entityId: requestId });
  });
}

/** REVIEW → REJECTED with a mandatory reason, audited. */
export async function rejectRequest(tenancy: Tenancy, actor: Actor, requestId: string, reason: string): Promise<void> {
  authorize(actor, "requests.process");
  const text = reason.trim();
  if (!text) throw new ReviewRefused("reason_missing");
  if (text.length > REJECTION_REASON_MAX) throw new ReviewRefused("reason_too_long");
  await tenancy.withTenant(actor.companyId, async (tx) => {
    const request = await lockForReview(tx, requestId);
    await transitionRequest(tx, request, "reject", { rejectionReason: text });
    await recordAudit(tx, { actorUserId: actor.userId, action: "request.rejected", entityType: "request", entityId: requestId, data: { reason: text } });
  });
}

export async function correctionHistory(tenancy: Tenancy, actor: Actor, requestId: string) {
  authorize(actor, "requests.process");
  return tenancy.withTenant(actor.companyId, (tx) =>
    tx.select().from(fieldCorrections).where(and(eq(fieldCorrections.requestId, requestId))).orderBy(asc(fieldCorrections.createdAt)),
  );
}
