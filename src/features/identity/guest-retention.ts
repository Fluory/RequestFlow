import { and, eq, inArray, like, lt, sql } from "drizzle-orm";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { listStorageKeys } from "@/features/documents";
import type { Tenancy } from "@/features/tenancy";
import { GUEST_EMAIL_DOMAIN, GUEST_SLUG_PREFIX } from "./guests";

// Guest retention of the showcase (ADR-0001 D7 amendment 2026-11-20): a guest company is deleted
// completely once it is older than GUEST_RETENTION_HOURS – its `app` rows (incl. the append-only audit
// trail, through the guarded database function `app.purge_guest_company`), its stored documents and its
// identity rows (company, membership, invitation, admission, the guest user with sessions and account).
// Runs as a pg-boss job (queue `guest-purge`, module `jobs`); every step is idempotent, so a retry after
// a failure simply finishes the work.

/** The purge was asked for a company that is not a guest company – never deleted. */
export class NotAGuestCompany extends Error {
  constructor() {
    super("not a guest company");
    this.name = "NotAGuestCompany";
  }
}

export interface GuestPurgeDeps {
  tenancy: Tenancy;
  storage: { delete(key: string): Promise<void> };
}

/** Guest companies created before `before`, oldest first (at most `limit`). */
export async function expiredGuestCompanies(db: Database, options: { before: Date; limit: number }): Promise<string[]> {
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(and(like(schema.organization.slug, `${GUEST_SLUG_PREFIX}%`), lt(schema.organization.createdAt, options.before)))
    .orderBy(schema.organization.createdAt)
    .limit(options.limit);
  return rows.map((row) => row.id);
}

/**
 * Deletes one guest company completely. Storage first (a failure leaves the rows, so the retry still
 * knows the keys; deleting a missing object is no error), then every row in ONE tenant transaction.
 */
export async function purgeGuestCompany(deps: GuestPurgeDeps, companyId: string): Promise<void> {
  const keys = await deps.tenancy.withTenant(companyId, async (tx) => {
    const [company] = await tx.select({ slug: schema.organization.slug }).from(schema.organization).where(eq(schema.organization.id, companyId));
    if (!company) return null;
    if (!company.slug.startsWith(GUEST_SLUG_PREFIX)) throw new NotAGuestCompany();
    return listStorageKeys(tx);
  });
  if (keys === null) return;
  for (const key of keys) await deps.storage.delete(key);

  await deps.tenancy.withTenant(companyId, async (tx) => {
    await tx.execute(sql`select app.purge_guest_company(${companyId}::uuid)`);
    const members = await tx.select({ userId: schema.member.userId }).from(schema.member).where(eq(schema.member.organizationId, companyId));
    // Cascades: member, invitation, guest_admission.
    await tx.delete(schema.organization).where(and(eq(schema.organization.id, companyId), like(schema.organization.slug, `${GUEST_SLUG_PREFIX}%`)));
    const userIds = members.map((member) => member.userId);
    // Only guest users (their address is in the reserved guest domain); cascades: session, account.
    if (userIds.length) {
      await tx.delete(schema.user).where(and(inArray(schema.user.id, userIds), like(schema.user.email, `%@${GUEST_EMAIL_DOMAIN}`)));
    }
  });
}
