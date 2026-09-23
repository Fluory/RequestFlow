import { listAuditEvents } from "@/features/audit";
import type { RequestRow } from "@/features/requests";
import type { TenantTx } from "@/features/tenancy";
import { quoteRequestSchema, type QuoteRequest } from "./contract";

/** Reviewed values of a request (the latest correction, else the extraction) – injected by the caller. */
export type FieldValues = (tx: TenantTx, requestId: string) => Promise<Record<string, string | null>>;

export class ExportNotPossible extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportNotPossible";
  }
}

/** ERP limits of the contract (maxLength of subject and fields). */
export const ERP_LIMITS = { subject: 300, field: 500 } as const;

/** Header fields that go to the ERP (contracts/erp-export.openapi.yaml). */
const EXPORTED_FIELDS = ["company", "contact_person", "requested_delivery_date"] as const;

/**
 * Header fields whose reviewed value would break the ERP contract (too long). Checked at approval, so
 * the clerk can still correct the value – after approval corrections are closed (#9 review).
 */
export function exportLimitViolations(subject: string | null, values: Record<string, string | null>): string[] {
  // Only the fields the ERP receives (contract v1) – a long free text that is never exported must
  // not block the approval (#22 review).
  const fields = EXPORTED_FIELDS.filter((key) => {
    const value = values[key];
    return value != null && value.length > ERP_LIMITS.field;
  });
  return subject !== null && subject.length > ERP_LIMITS.subject ? ["subject", ...fields] : fields;
}

/**
 * The ERP payload. Deterministic for an approved request (values are frozen after approval, the
 * approval time comes from its audit event), so a retry sends the same body under the same key.
 * A payload outside the contract (e.g. an overlong value) is refused here – never cut silently.
 */
export async function buildQuoteRequest(tx: TenantTx, request: RequestRow, fieldValues: FieldValues): Promise<QuoteRequest> {
  const approval = (await listAuditEvents(tx, "request", request.id)).filter((event) => event.action === "request.approved").at(-1);
  if (!approval) throw new ExportNotPossible("approval event missing");
  const values = await fieldValues(tx, request.id);
  const payload: QuoteRequest = {
    requestId: request.id,
    subject: request.subject ?? null,
    approvedAt: approval.createdAt.toISOString(),
    fields: {
      company: values.company ?? null,
      contactPerson: values.contact_person ?? null,
      requestedDeliveryDate: values.requested_delivery_date ?? null,
    },
  };
  if (!quoteRequestSchema.safeParse(payload).success) throw new ExportNotPossible("payload outside the ERP contract");
  return payload;
}
