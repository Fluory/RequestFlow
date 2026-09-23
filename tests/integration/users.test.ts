import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listAuditEvents } from "@/features/audit";
import { AuthorizationError, changeUserRole, getActor, inviteUser, LastAdminError, listCompanyUsers, setUserActive, UserNotInCompany, type Actor } from "@/features/identity";
import { createTenancy } from "@/features/tenancy";
import { call, companyWithAdmin, createStack, invitedUser, signIn, syntheticEmail, type Stack } from "./helpers/stack";

// The request context of the server actions is the only fake: `headers()` returns the cookie of the
// user under test. Everything else – runtime, Better Auth, database – is real.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
const { changeRoleAction, deactivateAction, reactivateAction } = await import("@/app/users/actions");
const { getRuntime } = await import("@/app/_server/runtime");

/** Runs a server action and returns where it sent the user (redirect target or 404). */
async function outcomeOf(action: (form: FormData) => Promise<void>, cookie: string, fields: Record<string, string>): Promise<string> {
  request.headers = new Headers({ cookie });
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  try {
    await action(form);
    return "no redirect";
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2]!;
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    throw error;
  }
}

describe("user management for company admins (#30)", () => {
  let stack: Stack;
  const actorOf = async (cookie: string) => (await getActor(stack.auth, stack.database.db, new Headers({ cookie })))!;
  const auditOf = (actor: Actor, userId: string) => createTenancy(stack.database.db).withTenant(actor.companyId, (tx) => listAuditEvents(tx, "user", userId));

  beforeAll(() => {
    stack = createStack();
  });

  afterAll(async () => {
    await getRuntime().database.pool.end();
    await stack.close();
  });

  it("lists the users of the own company only, with role, status and pending invitations", async () => {
    const a = await companyWithAdmin(stack);
    const admin = await actorOf(a.cookie);
    const clerk = await invitedUser(stack, admin, "clerk");
    const pending = syntheticEmail("offen");
    await inviteUser(stack.database.db, admin, { email: pending, role: "clerk" });
    const other = await companyWithAdmin(stack);

    const view = await listCompanyUsers(stack.database.db, admin);

    expect(view.users.map((user) => [user.email, user.role, user.active]).sort()).toEqual([
      [a.adminEmail, "admin", true],
      [clerk.email, "clerk", true],
    ]);
    expect(view.users.map((user) => user.email)).not.toContain(other.adminEmail);
    expect(view.invitations.map((invitation) => invitation.email)).toContain(pending.toLowerCase());
  });

  it("changes a role and audits it in the same transaction; invitations are audited too", async () => {
    const a = await companyWithAdmin(stack);
    const admin = await actorOf(a.cookie);
    const clerkCookie = (await invitedUser(stack, admin, "clerk")).cookie;
    const clerk = await actorOf(clerkCookie);

    await changeUserRole(stack.database.db, admin, clerk.userId, "admin");

    expect((await actorOf(clerkCookie)).role).toBe("admin");
    expect((await auditOf(admin, clerk.userId)).map((event) => [event.action, event.actorUserId, event.data])).toEqual([["user.role_changed", admin.userId, { from: "clerk", to: "admin" }]]);
    const { invitationId } = await inviteUser(stack.database.db, admin, { email: syntheticEmail("neu"), role: "clerk" });
    expect((await auditOf(admin, invitationId)).map((event) => event.action)).toEqual(["user.invited"]);
  });

  it("deactivating ends the sessions, blocks sign-in and is audited; reactivating allows sign-in again", async () => {
    const a = await companyWithAdmin(stack);
    const admin = await actorOf(a.cookie);
    const clerk = await invitedUser(stack, admin, "clerk");
    const clerkId = (await actorOf(clerk.cookie)).userId;

    await setUserActive(stack.database.db, admin, clerkId, false);

    expect(await getActor(stack.auth, stack.database.db, new Headers({ cookie: clerk.cookie }))).toBeNull();
    expect((await signIn(stack.auth, clerk.email)).status).toBeGreaterThanOrEqual(400);
    expect((await listCompanyUsers(stack.database.db, admin)).users.find((user) => user.userId === clerkId)?.active).toBe(false);

    await setUserActive(stack.database.db, admin, clerkId, true);

    expect((await signIn(stack.auth, clerk.email)).status).toBe(200);
    expect((await auditOf(admin, clerkId)).map((event) => event.action)).toEqual(["user.deactivated", "user.reactivated"]);
  });

  it("keeps the last active admin: demoting or deactivating them is refused, also for themselves", async () => {
    const a = await companyWithAdmin(stack);
    const admin = await actorOf(a.cookie);
    await invitedUser(stack, admin, "clerk");

    await expect(changeUserRole(stack.database.db, admin, admin.userId, "clerk")).rejects.toBeInstanceOf(LastAdminError);
    await expect(setUserActive(stack.database.db, admin, admin.userId, false)).rejects.toBeInstanceOf(LastAdminError);
    expect(await auditOf(admin, admin.userId)).toEqual([]);
  });

  it("serialises concurrent changes: two admins demoting each other leave exactly one admin", async () => {
    const a = await companyWithAdmin(stack);
    const first = await actorOf(a.cookie);
    const second = await actorOf((await invitedUser(stack, first, "admin")).cookie);

    const results = await Promise.allSettled([changeUserRole(stack.database.db, first, second.userId, "clerk"), changeUserRole(stack.database.db, second, first.userId, "clerk")]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: expect.any(LastAdminError) });
    const admins = (await listCompanyUsers(stack.database.db, first.role === "admin" ? first : second)).users.filter((user) => user.role === "admin");
    expect(admins).toHaveLength(1);
  });

  it("refuses users of another company and clerks (module)", async () => {
    const a = await companyWithAdmin(stack);
    const admin = await actorOf(a.cookie);
    const clerk = await actorOf((await invitedUser(stack, admin, "clerk")).cookie);
    const foreignAdmin = await actorOf((await companyWithAdmin(stack)).cookie);

    await expect(setUserActive(stack.database.db, foreignAdmin, clerk.userId, false)).rejects.toBeInstanceOf(UserNotInCompany);
    await expect(changeUserRole(stack.database.db, clerk, admin.userId, "clerk")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listCompanyUsers(stack.database.db, clerk)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("server actions: a clerk gets 404 for every action and changes nothing; an admin's actions redirect with fixed codes", async () => {
    const a = await companyWithAdmin(stack);
    const admin = await actorOf(a.cookie);
    const clerk = await invitedUser(stack, admin, "clerk");
    const clerkId = (await actorOf(clerk.cookie)).userId;

    expect(await outcomeOf(changeRoleAction, clerk.cookie, { userId: admin.userId, role: "clerk" })).toBe("404");
    expect(await outcomeOf(deactivateAction, clerk.cookie, { userId: admin.userId })).toBe("404");
    expect(await outcomeOf(reactivateAction, clerk.cookie, { userId: admin.userId })).toBe("404");
    expect((await actorOf(a.cookie)).role).toBe("admin");

    expect(await outcomeOf(changeRoleAction, a.cookie, { userId: admin.userId, role: "clerk" })).toBe("/users?error=last_admin");
    expect(await outcomeOf(deactivateAction, a.cookie, { userId: "not-a-uuid" })).toBe("/users?error=unknown_user");
    expect(await outcomeOf(deactivateAction, a.cookie, { userId: clerkId })).toBe("/users?done=deactivated");
    expect(await outcomeOf(changeRoleAction, "", { userId: clerkId, role: "admin" })).toBe("/login");
  });

  it("the Better Auth admin plugin still gives company admins no user endpoints", async () => {
    const a = await companyWithAdmin(stack);

    const ban = await call(stack.auth, "/admin/ban-user", { cookie: a.cookie, body: { userId: (await actorOf(a.cookie)).userId } });

    expect([401, 403]).toContain(ban.status);
  });
});
