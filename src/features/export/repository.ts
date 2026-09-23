import { eq, inArray, sql } from "drizzle-orm";
import { requestExports } from "@/db/schema";
import { tenantOf, type TenantTx } from "@/features/tenancy";

export type ExportRecord = typeof requestExports.$inferSelect;

export async function getExportRecord(tx: TenantTx, requestId: string): Promise<ExportRecord | null> {
  tenantOf(tx);
  const [row] = await tx.select().from(requestExports).where(eq(requestExports.requestId, requestId));
  return row ?? null;
}

/** The one export row per request (unique request_id); the idempotency key is the request id. */
export async function ensureExportRecord(tx: TenantTx, requestId: string): Promise<ExportRecord> {
  const companyId = tenantOf(tx);
  await tx.insert(requestExports).values({ companyId, requestId, idempotencyKey: requestId }).onConflictDoNothing({ target: requestExports.requestId });
  return (await getExportRecord(tx, requestId))!;
}

export async function markExportSucceeded(tx: TenantTx, requestId: string, erpReference: string): Promise<void> {
  tenantOf(tx);
  await tx
    .update(requestExports)
    .set({ status: "succeeded", erpReference, exportedAt: new Date(), attempts: sql`${requestExports.attempts} + 1`, lastError: null })
    .where(eq(requestExports.requestId, requestId));
}

/** Counts a failed ERP call (its own transaction – the export transaction was rolled back). */
export async function recordExportAttemptFailure(tx: TenantTx, requestId: string, cause: string): Promise<void> {
  const companyId = tenantOf(tx);
  await tx
    .insert(requestExports)
    .values({ companyId, requestId, idempotencyKey: requestId, attempts: 1, lastError: cause })
    .onConflictDoUpdate({
      target: requestExports.requestId,
      set: { attempts: sql`${requestExports.attempts} + 1`, lastError: cause },
      setWhere: sql`${requestExports.status} = 'pending'`,
    });
}

/** Export state of several requests at once (request list, #26) – keyed by request id. */
export async function listExportRecords(tx: TenantTx, requestIds: string[]): Promise<Map<string, ExportRecord>> {
  tenantOf(tx);
  if (requestIds.length === 0) return new Map();
  const rows = await tx.select().from(requestExports).where(inArray(requestExports.requestId, requestIds));
  return new Map(rows.map((row) => [row.requestId, row]));
}
