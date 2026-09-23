import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import type { Auth } from "./auth";
import { isCompanyRole, type Actor } from "./authorize";

/**
 * The signed-in actor of a request: user, company and company role (ADR-0001 D7). The company is
 * the user's live membership (one company per user, unique index) – re-read on every call, so a
 * removed membership takes effect immediately; never from client input. A session whose active
 * organization disagrees with the membership fails closed. Better Auth clears the active
 * organization after a refused switch; the membership still identifies the company then.
 */
export async function getActor(auth: Auth, db: Database, headers: Headers): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers });
  // A deactivated user (#30) has no sessions left and cannot sign in; checked here as well.
  if (!session || (session.user as { banned?: boolean | null }).banned) return null;
  const [membership] = await db
    .select({ companyId: schema.member.organizationId, role: schema.member.role })
    .from(schema.member)
    .where(eq(schema.member.userId, session.user.id))
    .limit(1);
  if (!membership || !isCompanyRole(membership.role)) return null;
  const active = session.session.activeOrganizationId;
  if (active && active !== membership.companyId) return null;
  return { userId: session.user.id, companyId: membership.companyId, role: membership.role };
}
