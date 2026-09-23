import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import type { Auth } from "./auth";
import { isCompanyRole, type Actor } from "./authorize";

/**
 * The signed-in actor of a request: user, company and company role. The company comes from the
 * session's active organization and is re-checked against a live membership on every call, so a
 * removed membership takes effect immediately. Never from client input (ADR-0001 D7).
 */
export async function getActor(auth: Auth, db: Database, headers: Headers): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers });
  const companyId = session?.session.activeOrganizationId;
  if (!session || !companyId) return null;
  const [membership] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.userId, session.user.id), eq(schema.member.organizationId, companyId)))
    .limit(1);
  if (!membership || !isCompanyRole(membership.role)) return null;
  return { userId: session.user.id, companyId, role: membership.role };
}
