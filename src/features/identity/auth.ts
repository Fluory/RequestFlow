import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin, organization } from "better-auth/plugins";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { organizationAc, organizationRoles } from "./access";
import { isCompanyRole } from "./authorize";

export interface AuthSettings {
  secret: string;
  baseURL: string;
  /** Rate limit on /api/auth/* (built-in, database storage). Tests may tighten it. */
  rateLimit?: { window: number; max: number };
}

// Global admin-plugin role nobody holds in the pilot: company admins are `member.role = admin`
// and therefore cannot use the plugin's cross-company endpoints (list/ban/impersonate users).
const PLATFORM_ADMIN_ROLE = "platform-admin";

const lower = (value: string) => value.trim().toLowerCase();

/**
 * Better Auth for RequestFlow (ADR-0001 D6): e-mail + password, invite-only, organization = company,
 * admin plugin without any global admin, rate limit stored in the database.
 */
export function createAuth(db: Database, settings: AuthSettings) {
  const pendingInvitation = async (email: string) => {
    const [row] = await db
      .select()
      .from(schema.invitation)
      .where(
        and(
          sql`lower(${schema.invitation.email}) = ${lower(email)}`,
          eq(schema.invitation.status, "pending"),
          gt(schema.invitation.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row;
  };

  const membershipOf = async (userId: string) => {
    const [row] = await db.select().from(schema.member).where(eq(schema.member.userId, userId)).limit(1);
    return row;
  };

  return betterAuth({
    secret: settings.secret,
    baseURL: settings.baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    advanced: { database: { generateId: "uuid" } },
    emailAndPassword: { enabled: true, minPasswordLength: 12, autoSignIn: false },
    session: { expiresIn: 60 * 60 * 8, updateAge: 60 * 60 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: settings.rateLimit?.window ?? 60,
      max: settings.rateLimit?.max ?? 30,
      customRules: {
        "/sign-in/email": { window: 60, max: settings.rateLimit?.max ?? 5 },
        "/sign-up/email": { window: 60, max: settings.rateLimit?.max ?? 5 },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        creatorRole: "admin",
        ac: organizationAc,
        roles: organizationRoles,
        disableOrganizationDeletion: true,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
      }),
      admin({ defaultRole: "user", adminRoles: [PLATFORM_ADMIN_ROLE], allowImpersonatingAdmins: false }),
    ],
    databaseHooks: {
      user: {
        create: {
          // Invite-only: an account is created only for an e-mail with a pending, unexpired invitation.
          before: async (user) => {
            const invitation = await pendingInvitation(user.email);
            if (!invitation) {
              throw new APIError("FORBIDDEN", { message: "Registration requires an invitation." });
            }
            return { data: { ...user, email: lower(user.email), role: "user" } };
          },
          // The invitation becomes the membership: company and company role come from it.
          after: async (user) => {
            const invitation = await pendingInvitation(user.email);
            if (!invitation || !isCompanyRole(invitation.role)) return;
            await db.transaction(async (tx) => {
              await tx.insert(schema.member).values({
                organizationId: invitation.organizationId,
                userId: user.id,
                role: invitation.role as string,
                createdAt: new Date(),
              });
              await tx
                .update(schema.invitation)
                .set({ status: "accepted" })
                .where(eq(schema.invitation.id, invitation.id));
            });
          },
        },
      },
      session: {
        create: {
          // A session always carries the user's company; no membership → no session (fail closed).
          before: async (session) => {
            const membership = await membershipOf(session.userId);
            if (!membership || !isCompanyRole(membership.role)) return false;
            return { data: { ...session, activeOrganizationId: membership.organizationId } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
