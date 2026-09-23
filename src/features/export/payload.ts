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
