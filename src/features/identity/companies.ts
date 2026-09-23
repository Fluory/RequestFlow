import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { authorize, isCompanyRole, type Actor, type CompanyRole } from "./authorize";

const INVITATION_DAYS = 7;
// Invitations need an inviter (Better Auth schema). The first admin of a company is invited by this
// system user: it has no password account and no membership, so it can never obtain a session.
const SYSTEM_INVITER_EMAIL = "system@requestflow.invalid";

const lower = (value: string) => value.trim().toLowerCase();
const expiry = () => new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

export interface Company {
  id: string;
  name: string;
  slug: string;
}

async function systemInviterId(db: Database): Promise<string> {
  await db
    .insert(schema.user)
    .values({ name: "RequestFlow system", email: SYSTEM_INVITER_EMAIL, role: "user" })
    .onConflictDoNothing({ target: schema.user.email });
  const [row] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, SYSTEM_INVITER_EMAIL));
  if (!row) throw new Error("system inviter missing");
  return row.id;
}

/** Operator action (seed script): a new company plus the invitation for its first admin. */
export async function bootstrapCompany(
  db: Database,
  input: { name: string; slug: string; adminEmail: string },
): Promise<{ company: Company; invitationId: string }> {
  const inviterId = await systemInviterId(db);
  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(schema.organization)
      .values({ name: input.name, slug: input.slug, createdAt: new Date() })
      .returning({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug });
    if (!company) throw new Error("company insert returned no row");
    const [invitation] = await tx
      .insert(schema.invitation)
      .values({ organizationId: company.id, email: lower(input.adminEmail), role: "admin", status: "pending", expiresAt: expiry(), inviterId })
      .returning({ id: schema.invitation.id });
    if (!invitation) throw new Error("invitation insert returned no row");
    return { company, invitationId: invitation.id };
  });
}

/** Company admins invite staff into their own company only – the company comes from the actor. */
export async function inviteUser(
  db: Database,
  actor: Actor,
  input: { email: string; role: CompanyRole },
): Promise<{ invitationId: string }> {
  authorize(actor, "users.invite");
  if (!isCompanyRole(input.role)) throw new Error("unknown role");
  const email = lower(input.email);
  return db.transaction(async (tx) => {
    // Re-inviting replaces a pending invitation of the same company.
    await tx
      .update(schema.invitation)
      .set({ status: "canceled" })
      .where(
        and(
          eq(schema.invitation.organizationId, actor.companyId),
          sql`lower(${schema.invitation.email}) = ${email}`,
          eq(schema.invitation.status, "pending"),
        ),
      );
    const [row] = await tx
      .insert(schema.invitation)
      .values({ organizationId: actor.companyId, email, role: input.role, status: "pending", expiresAt: expiry(), inviterId: actor.userId })
      .returning({ id: schema.invitation.id });
    if (!row) throw new Error("invitation insert returned no row");
    return { invitationId: row.id };
  });
}

export async function getCompany(db: Database, companyId: string): Promise<Company | null> {
  const [row] = await db
    .select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, companyId));
  return row ?? null;
}
