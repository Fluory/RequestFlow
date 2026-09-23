import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { recordAudit } from "@/features/audit";
import { createTenancy, type TenantTx } from "@/features/tenancy";
import { authorize, isCompanyRole, type Actor, type CompanyRole } from "./authorize";
import { assertAdminRemains, type MemberChange, type MemberState } from "./last-admin";

// User management for company admins (#30). Everything runs in ONE tenant transaction with its audit
// event (ADR-0001 D10); the company always comes from the actor, never from input. A user belongs to
// exactly one company (#4), so deactivating the user (Better Auth admin plugin `banned`, which blocks
// sign-in) is deactivating the membership; their sessions are deleted in the same step.

export interface CompanyUser {
  userId: string;
  name: string;
  email: string;
  role: CompanyRole;
  active: boolean;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
}

/** Target user is not a member of the actor's company (or does not exist) – same answer for both. */
export class UserNotInCompany extends Error {
  constructor() {
    super("user is not a member of this company");
    this.name = "UserNotInCompany";
  }
}

const DEACTIVATED_REASON = "deactivated by a company admin";

/** Members of the company, row-locked: concurrent changes serialise, so the last-admin rule holds. */
async function lockMembers(tx: TenantTx, companyId: string): Promise<MemberState[]> {
  const rows = await tx
    .select({ userId: schema.member.userId, role: schema.member.role, banned: schema.user.banned })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, companyId))
    .orderBy(asc(schema.member.userId))
    .for("update");
  return rows.filter((row) => isCompanyRole(row.role)).map((row) => ({ userId: row.userId, role: row.role as CompanyRole, active: !row.banned }));
}

type AuditOf = { action: string; data: Record<string, unknown> } | null;

async function manage(db: Database, actor: Actor, userId: string, change: MemberChange, apply: (tx: TenantTx, before: MemberState) => Promise<AuditOf>) {
  authorize(actor, "users.manage");
  await createTenancy(db).withTenant(actor.companyId, async (tx) => {
    const members = await lockMembers(tx, actor.companyId);
    const before = members.find((member) => member.userId === userId);
    if (!before) throw new UserNotInCompany();
    assertAdminRemains(members, change);
    const audit = await apply(tx, before);
    if (audit) await recordAudit(tx, { actorUserId: actor.userId, entityType: "user", entityId: userId, action: audit.action, data: audit.data });
  });
}

export async function listCompanyUsers(db: Database, actor: Actor): Promise<{ users: CompanyUser[]; invitations: PendingInvitation[] }> {
  authorize(actor, "users.manage");
  return createTenancy(db).withTenant(actor.companyId, async (tx) => {
    const rows = await tx
      .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.member.role, banned: schema.user.banned })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, actor.companyId))
      .orderBy(asc(schema.user.email));
    const invitations = await tx
      .select({ id: schema.invitation.id, email: schema.invitation.email, role: schema.invitation.role, expiresAt: schema.invitation.expiresAt })
      .from(schema.invitation)
      .where(and(eq(schema.invitation.organizationId, actor.companyId), eq(schema.invitation.status, "pending")))
      .orderBy(asc(schema.invitation.email));
    return {
      users: rows.filter((row) => isCompanyRole(row.role)).map((row) => ({ userId: row.userId, name: row.name, email: row.email, role: row.role as CompanyRole, active: !row.banned })),
      invitations: invitations.map((row) => ({ ...row, role: row.role ?? "clerk" })),
    };
  });
}

export async function changeUserRole(db: Database, actor: Actor, userId: string, role: CompanyRole): Promise<void> {
  if (!isCompanyRole(role)) throw new Error("unknown role");
  await manage(db, actor, userId, { userId, role }, async (tx, before) => {
    if (before.role === role) return null;
    await tx
      .update(schema.member)
      .set({ role })
      .where(and(eq(schema.member.organizationId, actor.companyId), eq(schema.member.userId, userId)));
    return { action: "user.role_changed", data: { from: before.role, to: role } };
  });
}

/** Deactivate: blocks sign-in and ends every session now. Reactivate: sign-in works again. */
export async function setUserActive(db: Database, actor: Actor, userId: string, active: boolean): Promise<void> {
  await manage(db, actor, userId, { userId, active }, async (tx, before) => {
    if (before.active === active) return null;
    await tx
      .update(schema.user)
      .set(active ? { banned: false, banReason: null, banExpires: null } : { banned: true, banReason: DEACTIVATED_REASON, banExpires: null })
      .where(eq(schema.user.id, userId));
    if (!active) await tx.delete(schema.session).where(eq(schema.session.userId, userId));
    return { action: active ? "user.reactivated" : "user.deactivated", data: {} };
  });
}
