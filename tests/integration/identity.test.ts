import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { AuthorizationError, getActor, getCompany, inviteUser, type Actor } from "@/features/identity";
import {
  call,
  companyWithAdmin,
  createStack,
  freshIp,
  invitedUser,
  rateLimitKeyPrefix,
  signIn,
  signUp,
  syntheticEmail,
  type Stack,
} from "./helpers/stack";

describe("identity: invite-only login and companies", () => {
  let stack: Stack;
  const actorOf = async (cookie: string) => (await getActor(stack.auth, stack.database.db, new Headers({ cookie }))) as Actor;
  const userCount = async (email: string) =>
    (await stack.database.db.select().from(schema.user).where(eq(schema.user.email, email.toLowerCase()))).length;

  beforeAll(() => {
    stack = createStack();
  });

  afterAll(async () => {
    await stack.close();
  });

  // Better Auth answers a refused sign-up with the same generic response as a successful one
  // (anti-enumeration: nobody learns which addresses are invited). "Rejected" is therefore proven by
  // its effect: no user, no session token, no login.
  it("rejects a sign-up without an invitation: no user, no token, no login", async () => {
    const email = syntheticEmail("uninvited");

    const result = await signUp(stack.auth, email);

    expect((result.body as { token: unknown }).token).toBeNull();
    expect(result.cookie).not.toMatch(/session_token/);
    expect(await userCount(email)).toBe(0);
    expect((await signIn(stack.auth, email)).status).toBe(401);
  });

  it("rejects an invited address without the invitation id, or with a wrong one (no takeover by e-mail alone)", async () => {
    const { cookie } = await companyWithAdmin(stack);
    const email = syntheticEmail("target");
    await inviteUser(stack.database.db, await actorOf(cookie), { email, role: "clerk" });

    await signUp(stack.auth, email);
    await signUp(stack.auth, email, crypto.randomUUID());
    await signUp(stack.auth, email, "not-a-uuid");

    expect(await userCount(email)).toBe(0);
  });

  it("rejects the invitation id of one address for another address", async () => {
    const { cookie } = await companyWithAdmin(stack);
    const { invitationId } = await inviteUser(stack.database.db, await actorOf(cookie), { email: syntheticEmail("real"), role: "clerk" });
    const attacker = syntheticEmail("attacker");

    await signUp(stack.auth, attacker, invitationId);

    expect(await userCount(attacker)).toBe(0);
  });

  it("gives an invited user a session that carries their active company and role", async () => {
    const { company, cookie } = await companyWithAdmin(stack);

    const session = await call(stack.auth, "/get-session", { cookie });
    const actor = await actorOf(cookie);

    expect((session.body as { session: { activeOrganizationId: string } }).session.activeOrganizationId).toBe(company.id);
    expect(actor).toMatchObject({ companyId: company.id, role: "admin" });
  });

  it("uses UUIDs for companies, so company_id columns and the RLS cast match", async () => {
    const { company } = await companyWithAdmin(stack);

    expect(company.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("matches the invitation e-mail case-insensitively and consumes the invitation", async () => {
    const { company, cookie } = await companyWithAdmin(stack);
    const email = syntheticEmail("Clerk").toUpperCase();
    const { invitationId } = await inviteUser(stack.database.db, await actorOf(cookie), { email: email.toLowerCase(), role: "clerk" });

    await signUp(stack.auth, email, invitationId);
    const login = await signIn(stack.auth, email.toLowerCase());

    expect(await actorOf(login.cookie)).toMatchObject({ companyId: company.id, role: "clerk" });
    const [invitation] = await stack.database.db.select().from(schema.invitation).where(eq(schema.invitation.id, invitationId));
    expect(invitation?.status).toBe("accepted");
  });

  it("denies inviting to clerks – server-side function and the plugin's HTTP endpoint", async () => {
    const { company, cookie } = await companyWithAdmin(stack);
    const clerk = await invitedUser(stack, await actorOf(cookie), "clerk");

    await expect(inviteUser(stack.database.db, await actorOf(clerk.cookie), { email: syntheticEmail("x"), role: "admin" })).rejects.toThrow(
      AuthorizationError,
    );
    const viaPlugin = await call(stack.auth, "/organization/invite-member", {
      cookie: clerk.cookie,
      body: { email: syntheticEmail("y"), role: "admin", organizationId: company.id },
    });
    expect([403, 404]).toContain(viaPlugin.status);
  });

  it("accepts only the pilot roles through the plugin's HTTP endpoints", async () => {
    const { company, cookie } = await companyWithAdmin(stack);

    const owner = await call(stack.auth, "/organization/invite-member", {
      cookie,
      body: { email: syntheticEmail("o"), role: "owner", organizationId: company.id },
    });

    expect(owner.status).toBeGreaterThanOrEqual(400);
    const pending = await stack.database.db.select().from(schema.invitation).where(sql`${schema.invitation.role} = 'owner'`);
    expect(pending).toHaveLength(0);
  });

  it("gives a company admin no access to the global admin plugin (no cross-company user list)", async () => {
    const { cookie } = await companyWithAdmin(stack);

    const listUsers = await call(stack.auth, "/admin/list-users", { cookie });

    expect([401, 403]).toContain(listUsers.status);
  });

  it("does not let a user create another company", async () => {
    const { cookie } = await companyWithAdmin(stack);

    const created = await call(stack.auth, "/organization/create", { cookie, body: { name: "Fremdfirma", slug: syntheticEmail("s") } });

    expect([403, 404]).toContain(created.status);
  });

  it("refuses switching the active company to a foreign one and listing its members", async () => {
    const a = await companyWithAdmin(stack);
    const b = await companyWithAdmin(stack);

    const switched = await call(stack.auth, "/organization/set-active", { cookie: a.cookie, body: { organizationId: b.company.id } });
    const members = await call(stack.auth, `/organization/list-members?organizationId=${b.company.id}`, { cookie: a.cookie });

    expect(switched.status).toBeGreaterThanOrEqual(400);
    expect(members.status).toBeGreaterThanOrEqual(400);
    expect((await actorOf(a.cookie)).companyId).toBe(a.company.id);
  });

  it("routes member and company changes only through the audited module: the plugin endpoints are disabled (#30)", async () => {
    const { company, cookie } = await companyWithAdmin(stack);
    const admin = await actorOf(cookie);
    const clerk = await invitedUser(stack, admin, "clerk");
    const clerkId = (await actorOf(clerk.cookie)).userId;
    const memberIdOf = async (userId: string) =>
      (await stack.database.db.select({ id: schema.member.id }).from(schema.member).where(sql`${schema.member.userId} = ${userId}`))[0]!.id;

    const attempts = {
      promote: await call(stack.auth, "/organization/update-member-role", { cookie, body: { memberId: await memberIdOf(clerkId), role: "admin", organizationId: company.id } }),
      remove: await call(stack.auth, "/organization/remove-member", { cookie, body: { memberIdOrEmail: await memberIdOf(clerkId), organizationId: company.id } }),
      invite: await call(stack.auth, "/organization/invite-member", { cookie, body: { email: syntheticEmail("p"), role: "clerk", organizationId: company.id } }),
      // The only admin leaving would leave the company without an admin – unaudited.
      leave: await call(stack.auth, "/organization/leave", { cookie, body: { organizationId: company.id } }),
      rename: await call(stack.auth, "/organization/update", { cookie, body: { data: { name: "Umbenannt" }, organizationId: company.id } }),
      // Clerks must not read the member list (user management is admin-only).
      listByClerk: await call(stack.auth, `/organization/list-members?organizationId=${company.id}`, { cookie: clerk.cookie }),
      fullByClerk: await call(stack.auth, `/organization/get-full-organization?organizationId=${company.id}`, { cookie: clerk.cookie }),
    };

    expect(Object.fromEntries(Object.entries(attempts).map(([name, response]) => [name, response.status]))).toEqual({
      promote: 404,
      remove: 404,
      invite: 404,
      leave: 404,
      rename: 404,
      listByClerk: 404,
      fullByClerk: 404,
    });
    expect(await actorOf(clerk.cookie)).toMatchObject({ role: "clerk", companyId: company.id });
    expect(await actorOf(cookie)).toMatchObject({ role: "admin", companyId: company.id });
    expect((await getCompany(stack.database.db, company.id))?.name).toBe(company.name);
  });

  it("refuses removing the last admin of a company", async () => {
    const { company, cookie } = await companyWithAdmin(stack);
    const admin = await actorOf(cookie);

    const [membership] = await stack.database.db.select({ id: schema.member.id }).from(schema.member).where(eq(schema.member.userId, admin.userId));
    const removed = await call(stack.auth, "/organization/remove-member", {
      cookie,
      body: { memberIdOrEmail: membership!.id, organizationId: company.id },
    });

    expect(removed.status).toBe(404);
    expect(await actorOf(cookie)).not.toBeNull();
  });

  it("allows one company per user: a second membership is refused by the database", async () => {
    const a = await companyWithAdmin(stack);
    const b = await companyWithAdmin(stack);
    const admin = await actorOf(a.cookie);

    const second = stack.database.db
      .insert(schema.member)
      .values({ organizationId: b.company.id, userId: admin.userId, role: "clerk", createdAt: new Date() });

    await expect(second).rejects.toThrow();
  });

  it("rejects a login without membership (fail closed)", async () => {
    const { cookie, adminEmail } = await companyWithAdmin(stack);
    const admin = await actorOf(cookie);
    await stack.database.db.delete(schema.member).where(eq(schema.member.userId, admin.userId));

    expect(await getActor(stack.auth, stack.database.db, new Headers({ cookie }))).toBeNull();
    expect((await signIn(stack.auth, adminEmail)).status).not.toBe(200);
  });

  // Proves the limiter and its database storage. The client IP comes from the configured header,
  // which only a trusted reverse proxy may set in a real deployment (see operations.md).
  it("rate-limits repeated sign-ins over HTTP and stores the counter in the database", async () => {
    const limited = createStack({ rateLimit: { window: 60, max: 3 } });
    const ip = freshIp();
    const email = syntheticEmail("brute");
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt++) statuses.push((await signIn(limited.auth, email, ip)).status);

      expect(statuses).toContain(429);
      const rows = await limited.database.db.select().from(schema.rateLimit).where(sql`${schema.rateLimit.key} like ${`${rateLimitKeyPrefix(ip)}%`}`);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });
});
