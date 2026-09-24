import { listAuditEvents } from "@/features/audit";
import type { RequestRow } from "@/features/requests";
import type { TenantTx } from "@/features/tenancy";
import { quoteRequestSchema, type QuoteRequest, type QuoteRequestLineItem } from "./contract";

/** Reviewed values of a request (the latest correction, else the extraction) – injected by the caller. */
export type FieldValues = (tx: TenantTx, requestId: string) => Promise<Record<string, string | null>>;

/** Reviewed positions in document order, one record of item fields each – injected by the caller (#46). */
export type LineItemValues = (tx: TenantTx, requestId: string) => Promise<Array<Record<string, string | null>>>;

export class ExportNotPossible extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportNotPossible";
  }
}

/** ERP limits of the contract: maxLength of subject and fields, maxItems of positions, body size. */
export const ERP_LIMITS = { subject: 300, field: 500, lineItems: 200, bodyBytes: 64 * 1024 } as const;

/** Header fields that go to the ERP (contracts/erp-export.openapi.yaml). */
const EXPORTED_FIELDS = ["company", "contact_person", "requested_delivery_date"] as const;
/** Position fields that go to the ERP (contract 1.1.0, #46). */
const EXPORTED_ITEM_FIELDS = ["description", "quantity", "unit", "material", "dimensions"] as const;

function toLineItems(items: Array<Record<string, string | null>>): QuoteRequestLineItem[] {
  return items.map((item, index) => ({
    position: index + 1,
    description: item.description ?? null,
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    material: item.material ?? null,
    dimensions: item.dimensions ?? null,
  }));
}

/**
 * Values whose reviewed state would break the ERP contract (too long, too many positions, body too
 * large). Checked at approval, so the clerk can still correct them – after approval corrections are
 * closed (#9 review). Returns field keys, `item N <field>` for positions, `lineItems` or `body`.
 */
export function exportLimitViolations(subject: string | null, values: Record<string, string | null>, items: Array<Record<string, string | null>> = []): string[] {
  // Only the fields the ERP receives – a long free text that is never exported must not block the
  // approval (#22 review).
  const violations: string[] = EXPORTED_FIELDS.filter((key) => {
    const value = values[key];
    return value != null && value.length > ERP_LIMITS.field;
  });
  if (subject !== null && subject.length > ERP_LIMITS.subject) violations.unshift("subject");
  items.forEach((item, index) => {
    for (const key of EXPORTED_ITEM_FIELDS) {
      const value = item[key];
      if (value != null && value.length > ERP_LIMITS.field) violations.push(`item ${index + 1} ${key}`);
    }
  });
  if (items.length > ERP_LIMITS.lineItems) violations.push("lineItems");
  // The ERP refuses bodies over 64 KiB before reading them; a generous estimate of the envelope
  // (ids, timestamps, keys) keeps the check on the safe side.
  const estimate = JSON.stringify({ subject, values: EXPORTED_FIELDS.map((key) => values[key] ?? null), items: toLineItems(items) });
  if (Buffer.byteLength(estimate, "utf8") + 1024 > ERP_LIMITS.bodyBytes) violations.push("body");
  return violations;
}

/**
 * The ERP payload. Deterministic for an approved request (values are frozen after approval, the
 * approval time comes from its audit event), so a retry sends the same body under the same key.
 * Positions are sent only when there are any – a request without positions keeps the 1.0.0 body.
 * A payload outside the contract (e.g. an overlong value) is refused here – never cut silently.
 */
export async function buildQuoteRequest(tx: TenantTx, request: RequestRow, fieldValues: FieldValues, lineItemValues: LineItemValues): Promise<QuoteRequest> {
  const approval = (await listAuditEvents(tx, "request", request.id)).filter((event) => event.action === "request.approved").at(-1);
  if (!approval) throw new ExportNotPossible("approval event missing");
  const values = await fieldValues(tx, request.id);
  const items = await lineItemValues(tx, request.id);
  const payload: QuoteRequest = {
    requestId: request.id,
    subject: request.subject ?? null,
    approvedAt: approval.createdAt.toISOString(),
    fields: {
      company: values.company ?? null,
      contactPerson: values.contact_person ?? null,
      requestedDeliveryDate: values.requested_delivery_date ?? null,
    },
    ...(items.length > 0 ? { lineItems: toLineItems(items) } : {}),
  };
  if (!quoteRequestSchema.safeParse(payload).success) throw new ExportNotPossible("payload outside the ERP contract");
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > ERP_LIMITS.bodyBytes) throw new ExportNotPossible("payload larger than the ERP accepts");
  return payload;
}
