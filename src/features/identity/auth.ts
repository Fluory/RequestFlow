import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin, organization } from "better-auth/plugins";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { organizationAc, organizationRoles, PLATFORM_ADMIN_ROLE, platformRoles } from "./access";
import { isCompanyRole } from "./authorize";

export interface AuthSettings {
  secret: string;
  baseURL: string;
  /** Client-IP source for rate limiting; must match the deployment's proxy setup. */
  ipAddressHeaders?: string[];
  trustedProxies?: string[];
  /** Rate limit on /api/auth/* (built-in, database storage). Tests may tighten it. */
  rateLimit?: { window: number; max: number };
}

const lower = (value: string) => value.trim().toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invitationIdOf = (context: { body?: unknown } | null) =>
  (context?.body as { invitationId?: unknown } | undefined)?.invitationId;

/**
 * Better Auth for RequestFlow (ADR-0001 D6): e-mail + password, invite-only, organization = company,
 * admin plugin without any global admin, rate limit stored in the database.
 */
export function createAuth(db: Database, settings: AuthSettings) {
  // Invite-only: the sign-up must present the invitation id (a random UUID handed over as a link)
  // AND the invited e-mail. An e-mail alone proves nothing – addresses are guessable and unverified.
  const pendingInvitation = async (email: string, invitationId: unknown) => {
    if (typeof invitationId !== "string" || !UUID.test(invitationId)) return undefined;
    const [row] = await db
      .select()
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.id, invitationId),
          sql`lower(${schema.invitation.email}) = ${lower(email)}`,
          eq(schema.invitation.status, "pending"),
          gt(schema.invitation.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row;
  };

  const membershipOf = async (userId: string) => {
    // One company per user (unique index on member.user_id); ordered for determinism anyway.
    const [row] = await db.select().from(schema.member).where(eq(schema.member.userId, userId)).orderBy(asc(schema.member.createdAt)).limit(1);
    return row;
  };

  return betterAuth({
    secret: settings.secret,
    baseURL: settings.baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    advanced: {
      database: { generateId: "uuid" },
      ipAddress: {
        ipAddressHeaders: settings.ipAddressHeaders ?? ["x-forwarded-for"],
        ...(settings.trustedProxies?.length ? { trustedProxies: settings.trustedProxies } : {}),
      },
    },
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
        // Better Auth gives the creator role ALL plugin permissions regardless of `roles`. Nobody may hold
        // it: companies are created by `bootstrapCompany`, and the role hooks below refuse "owner" – so
        // member and invitation changes can only go through the audited `identity` module (#30).
        creatorRole: "owner",
        ac: organizationAc,
        roles: organizationRoles,
        disableOrganizationDeletion: true,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
        // Only the pilot's two company roles – no plugin defaults (owner/member), no role lists.
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => {
            if (!isCompanyRole(invitation.role)) throw new APIError("BAD_REQUEST", { message: "Unknown role." });
          },
          beforeUpdateMemberRole: async ({ newRole }) => {
            if (!isCompanyRole(newRole)) throw new APIError("BAD_REQUEST", { message: "Unknown role." });
          },
          beforeAddMember: async ({ member }) => {
            if (!isCompanyRole(member.role)) throw new APIError("BAD_REQUEST", { message: "Unknown role." });
          },
        },
      }),
      // Company admins are `member.role = admin`, never a global admin-plugin role, so they cannot use
      // the plugin's cross-company endpoints (list/ban/impersonate users).
      admin({
        defaultRole: "user",
        adminRoles: [PLATFORM_ADMIN_ROLE],
        roles: platformRoles,
        allowImpersonatingAdmins: false,
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // Invite-only: an account is created only for an e-mail with a pending, unexpired invitation.
          before: async (user, context) => {
            const invitation = await pendingInvitation(user.email, invitationIdOf(context));
            if (!invitation) {
              throw new APIError("FORBIDDEN", { message: "Registration requires an invitation." });
            }
            return { data: { ...user, email: lower(user.email), role: "user" } };
          },
          // The invitation becomes the membership: company and company role come from it.
          after: async (user, context) => {
            const invitation = await pendingInvitation(user.email, invitationIdOf(context));
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
