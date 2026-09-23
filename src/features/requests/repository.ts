import { and, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { requests, type RequestStatus } from "@/db/schema";
import { tenantOf, type TenantTx } from "@/features/tenancy";
import { nextStatus, type RequestEvent } from "./status";

export type RequestRow = typeof requests.$inferSelect;

export interface NewRequest {
  id?: string;
  createdBy?: string | null;
  subject?: string | null;
  messageId?: string | null;
  fingerprint?: string | null;
  possibleDuplicate?: boolean;
  duplicateOfId?: string | null;
}

// Repository of the request aggregate. Every function needs a tenant transaction; the company id is
// taken from it, never from the caller – RLS enforces the same rule in the database.
export async function listRequests(tx: TenantTx): Promise<RequestRow[]> {
  tenantOf(tx);
  return tx.select().from(requests).orderBy(desc(requests.createdAt));
}

export async function getRequest(tx: TenantTx, id: string): Promise<RequestRow | null> {
  tenantOf(tx);
  const [row] = await tx.select().from(requests).where(eq(requests.id, id));
  return row ?? null;
}

export async function createRequest(tx: TenantTx, input: NewRequest = {}): Promise<RequestRow> {
  const companyId = tenantOf(tx);
  const [row] = await tx.insert(requests).values({ ...input, companyId, status: "NEW" satisfies RequestStatus }).returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/**
 * Serialises duplicate detection per company for the rest of the transaction, so two identical
 * uploads at the same moment cannot both miss each other.
 */
export async function lockDuplicateDetection(tx: TenantTx): Promise<void> {
  const companyId = tenantOf(tx);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`intake-duplicates:${companyId}`}, 0))`);
}

/**
 * The earliest request of the same company with the same Message-ID or the same file fingerprint
 * (exact duplicate, ADR-0001 D9). Tenant-scoped by RLS: other companies' requests never match.
 */
export async function findDuplicate(
  tx: TenantTx,
  keys: { messageId: string | null; fingerprint: string },
): Promise<RequestRow | null> {
  tenantOf(tx);
  const conditions: SQL[] = [eq(requests.fingerprint, keys.fingerprint)];
  if (keys.messageId) conditions.push(eq(requests.messageId, keys.messageId));
  const [row] = await tx
    .select()
    .from(requests)
    .where(and(or(...conditions)))
    .orderBy(asc(requests.createdAt))
    .limit(1);
  return row ?? null;
}

/** Locks the request row for the rest of the transaction (status changes are serialised). */
export async function lockRequest(tx: TenantTx, id: string): Promise<RequestRow | null> {
  tenantOf(tx);
  const [row] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
  return row ?? null;
}

type StatePatch = Partial<Pick<RequestRow, "errorStage" | "errorMessage" | "attempts" | "nextRetryAt">>;

/** Applies a status-machine event to a locked row; illegal transitions throw before any write. */
export async function transitionRequest(tx: TenantTx, row: RequestRow, event: RequestEvent, patch: StatePatch = {}): Promise<RequestRow> {
  tenantOf(tx);
  const status = nextStatus(row.status, event);
  const [updated] = await tx.update(requests).set({ status, ...patch }).where(eq(requests.id, row.id)).returning();
  if (!updated) throw new Error("request vanished during transition");
  return updated;
}

/** Keeps the last failure visible while a retry is pending (status unchanged). */
export async function recordProcessingFailure(tx: TenantTx, id: string, failure: { message: string; nextRetryAt: Date | null }): Promise<void> {
  tenantOf(tx);
  await tx.update(requests).set({ errorMessage: failure.message, nextRetryAt: failure.nextRetryAt }).where(eq(requests.id, id));
}
