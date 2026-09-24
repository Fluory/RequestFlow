import { and, asc, desc, eq, gte, or, sql, type SQL } from "drizzle-orm";
import { requests, type RequestStatus } from "@/db/schema";
import { tenantOf, type TenantTx } from "@/features/tenancy";
import { parseCursor, REQUEST_PAGE_SIZE } from "./cursor";
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
export interface RequestFilter {
  status?: RequestStatus;
  /** true: only possible duplicates; false: only non-duplicates; undefined: all. */
  possibleDuplicate?: boolean;
}

export interface RequestPage {
  rows: RequestRow[];
  /** Cursor of the next (older) page, or null on the last page. */
  nextCursor: string | null;
  /** false when a valid cursor positioned this page; a missing, unknown or foreign cursor gives the first page. */
  firstPage: boolean;
}

/**
 * One page of the company's requests, newest first, optionally filtered (#26, #48). Keyset paging on
 * (created_at desc, id desc): `after` is the id of the last row of the previous page; its position is
 * read inside this tenant transaction, so a malformed, unknown or foreign id yields the first page.
 */
export async function listRequests(tx: TenantTx, filter: RequestFilter = {}, page: { after?: string | null } = {}): Promise<RequestPage> {
  tenantOf(tx);
  const cursor = parseCursor(page.after);
  // The anchor's created_at is read as text at full (microsecond) precision in the same query as its
  // id, so a JS Date never truncates it and there is no second lookup that could miss (#48 review).
  const anchor = cursor
    ? (await tx.select({ id: requests.id, createdAt: sql<string>`${requests.createdAt}::text` }).from(requests).where(eq(requests.id, cursor)))[0]
    : undefined;
  const conditions = [
    filter.status ? eq(requests.status, filter.status) : undefined,
    filter.possibleDuplicate === undefined ? undefined : eq(requests.possibleDuplicate, filter.possibleDuplicate),
    anchor ? sql`(${requests.createdAt}, ${requests.id}) < (${anchor.createdAt}::timestamptz, ${anchor.id}::uuid)` : undefined,
  ].filter((condition) => condition !== undefined);
  const rows = await tx
    .select()
    .from(requests)
    .where(and(...conditions))
    .orderBy(desc(requests.createdAt), desc(requests.id))
    .limit(REQUEST_PAGE_SIZE + 1);
  const hasMore = rows.length > REQUEST_PAGE_SIZE;
  const visible = hasMore ? rows.slice(0, REQUEST_PAGE_SIZE) : rows;
  return { rows: visible, nextCursor: hasMore ? visible.at(-1)!.id : null, firstPage: anchor === undefined };
}

/** Number of the company's requests per status (start page); statuses without requests are absent. */
export async function countRequestsByStatus(tx: TenantTx): Promise<Partial<Record<RequestStatus, number>>> {
  tenantOf(tx);
  const rows = await tx
    .select({ status: requests.status, count: sql<number>`count(*)::int` })
    .from(requests)
    .groupBy(requests.status);
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
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

type StatePatch = Partial<Pick<RequestRow, "errorStage" | "errorMessage" | "attempts" | "nextRetryAt" | "rejectionReason" | "duplicateDecision">>;

/** Records the clerk's "not a duplicate" decision (#27) on a locked row – no status change. */
export async function recordDuplicateDecision(tx: TenantTx, row: RequestRow, decision: "distinct"): Promise<void> {
  tenantOf(tx);
  await tx.update(requests).set({ duplicateDecision: decision }).where(eq(requests.id, row.id));
}

/** Applies a status-machine event to a locked row; illegal transitions throw before any write. */
export async function transitionRequest(tx: TenantTx, row: RequestRow, event: RequestEvent, patch: StatePatch = {}): Promise<RequestRow> {
  tenantOf(tx);
  const status = nextStatus(row.status, event);
  const [updated] = await tx.update(requests).set({ status, ...patch }).where(eq(requests.id, row.id)).returning();
  if (!updated) throw new Error("request vanished during transition");
  return updated;
}

/** Keeps the last failure visible while a retry is pending (status unchanged). */
/** Next export attempt of an APPROVED request (#26 list); a request that moved on is left alone. */
export async function recordExportRetry(tx: TenantTx, id: string, nextRetryAt: Date | null): Promise<void> {
  tenantOf(tx);
  await tx.update(requests).set({ nextRetryAt }).where(and(eq(requests.id, id), eq(requests.status, "APPROVED")));
}

export async function recordProcessingFailure(tx: TenantTx, id: string, failure: { message: string; nextRetryAt: Date | null }): Promise<void> {
  tenantOf(tx);
  // Only while processing: a late failure of a redelivered attempt must not stamp a request that
  // another attempt already moved on (REVIEW, ERROR).
  await tx
    .update(requests)
    .set({ errorMessage: failure.message, nextRetryAt: failure.nextRetryAt })
    .where(and(eq(requests.id, id), eq(requests.status, "PROCESSING")));
}

/** Requests a user created since `since` (upload rate limit, #59 review) – within the tenant. */
export async function countRequestsCreatedBy(tx: TenantTx, userId: string, since: Date): Promise<number> {
  tenantOf(tx);
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(requests)
    .where(and(eq(requests.createdBy, userId), gte(requests.createdAt, since)));
  return row?.count ?? 0;
}
