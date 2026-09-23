import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { AuthorizationError, getActor, inviteUser } from "@/features/identity";
import { call, companyWithAdmin, createStack, freshIp, signIn, signUp, syntheticEmail, type Stack } from "./helpers/stack";

describe("identity: invite-only login and companies", () => {
  let stack: Stack;

  beforeAll(() => {
    stack = createStack();
  });

  afterAll(async () => {
    await stack.close();
  });

  it("rejects a sign-up without an invitation and creates no user", async () => {
    const email = syntheticEmail("uninvited");

    const result = await signUp(stack.auth, email);

    expect(result.status).toBe(403);
    const users = await stack.database.db.select().from(schema.user).where(eq(schema.user.email, email));
    expect(users).toHaveLength(0);
  });

  it("gives an invited user a session that carries their active company and role", async () => {
    const { company, cookie } = await companyWithAdmin(stack);

    const session = await call(stack.auth, "/get-session", { cookie });
    const actor = await getActor(stack.auth, stack.database.db, new Headers({ cookie }));

    expect((session.body as { session: { activeOrganizationId: string } }).session.activeOrganizationId).toBe(company.id);
    expect(actor).toMatchObject({ companyId: company.id, role: "admin" });
  });

  it("uses UUIDs for companies, so company_id columns and the RLS cast match", async () => {
    const { company } = await companyWithAdmin(stack);

    expect(company.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("matches the invitation e-mail case-insensitively and consumes the invitation", async () => {
    const { company, cookie } = await companyWithAdmin(stack);
    const admin = await getActor(stack.auth, stack.database.db, new Headers({ cookie }));
    const email = syntheticEmail("Clerk").replace("Clerk", "CLERK");
    const { invitationId } = await inviteUser(stack.database.db, admin!, { email: email.toLowerCase(), role: "clerk" });

    expect((await signUp(stack.auth, email)).status).toBe(200);
    const login = await signIn(stack.auth, email.toLowerCase());
    const clerk = await getActor(stack.auth, stack.database.db, new Headers({ cookie: login.cookie }));

    expect(clerk).toMatchObject({ companyId: company.id, role: "clerk" });
    const [invitation] = await stack.database.db.select().from(schema.invitation).where(eq(schema.invitation.id, invitationId));
    expect(invitation?.status).toBe("accepted");
  });

  it("denies inviting to clerks – server-side function and the plugin's HTTP endpoint", async () => {
    const { company, cookie } = await companyWithAdmin(stack);
    const admin = await getActor(stack.auth, stack.database.db, new Headers({ cookie }));
    const clerkEmail = syntheticEmail("clerk");
    await inviteUser(stack.database.db, admin!, { email: clerkEmail, role: "clerk" });
    await signUp(stack.auth, clerkEmail);
    const clerkLogin = await signIn(stack.auth, clerkEmail);
    const clerk = await getActor(stack.auth, stack.database.db, new Headers({ cookie: clerkLogin.cookie }));

    await expect(inviteUser(stack.database.db, clerk!, { email: syntheticEmail("x"), role: "admin" })).rejects.toThrow(AuthorizationError);
    const viaPlugin = await call(stack.auth, "/organization/invite-member", {
      cookie: clerkLogin.cookie,
      body: { email: syntheticEmail("y"), role: "admin", organizationId: company.id },
    });
    expect(viaPlugin.status).toBe(403);
  });

  it("gives a company admin no access to the global admin plugin (no cross-company user list)", async () => {
    const { cookie } = await companyWithAdmin(stack);

    const listUsers = await call(stack.auth, "/admin/list-users", { cookie });

    expect([401, 403]).toContain(listUsers.status);
  });

  it("does not let a user create another company", async () => {
    const { cookie } = await companyWithAdmin(stack);

    const created = await call(stack.auth, "/organization/create", { cookie, body: { name: "Fremdfirma", slug: syntheticEmail("s") } });

    expect(created.status).toBe(403);
  });

  it("rejects a login without membership (fail closed)", async () => {
    const { cookie } = await companyWithAdmin(stack);
    const admin = await getActor(stack.auth, stack.database.db, new Headers({ cookie }));
    await stack.database.db.delete(schema.member).where(eq(schema.member.userId, admin!.userId));

    expect(await getActor(stack.auth, stack.database.db, new Headers({ cookie }))).toBeNull();
    const [user] = await stack.database.db.select().from(schema.user).where(eq(schema.user.id, admin!.userId));
    expect((await signIn(stack.auth, user!.email)).status).not.toBe(200);
  });

  it("rate-limits repeated sign-ins over HTTP and stores the counter in the database", async () => {
    const limited = createStack({ rateLimit: { window: 60, max: 3 } });
    const ip = freshIp();
    const email = syntheticEmail("brute");
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt++) statuses.push((await signIn(limited.auth, email, ip)).status);

      expect(statuses).toContain(429);
      const rows = await limited.database.db.select().from(schema.rateLimit).where(sql`${schema.rateLimit.key} like ${`%${ip}%`}`);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });
});
