import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { createJobQueue } from "@/db/job-queue-client";
import { createErpMock, MemoryMockStore } from "@/features/erp-mock";
import { createErpClient } from "@/features/export";
import { AuthorizationError, createGuestAccount, getActor, getCompany, GuestClientLimitReached, GuestLimitReached, GUEST_SLUG_PREFIX, inviteUser, type Actor } from "@/features/identity";
import { submitUpload } from "@/features/intake";
import { currentFieldValues, currentLineItemValues } from "@/features/review";
import { seedSamples, type SampleDeps } from "@/features/samples";
import { S3BlobStore } from "@/features/storage";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, unique, type Stack } from "./helpers/stack";

// Guest access of the showcase (#126) against real Postgres, Better Auth, pg-boss and S3: a guest gets a
// company of its own through the invite-only path, sees only its own data, may work on the prepared
// samples (recorded answers) but never start a live model call.
const TOKEN = "local-dev-only-erp-token-0123456789";

describe("guest access", () => {
  let stack: Stack;
  let tenancy: Tenancy;
  let storage: S3BlobStore;
  let boss: PgBoss;

  const deps = (): SampleDeps => {
    const mock = createErpMock({ token: TOKEN, store: new MemoryMockStore() });
    const fetchImpl: typeof fetch = async (input, init) => mock.handle(new Request(input, init));
    return {
      tenancy,
      storage,
      boss,
      limits: { ...loadConfig().upload, maxPerHour: undefined },
      export: { tenancy, erp: createErpClient({ baseUrl: "http://web/api/erp-mock", token: TOKEN, timeoutMs: 2_000, fetch: fetchImpl }), fieldValues: currentFieldValues, lineItemValues: currentLineItemValues },
    };
  };
  const requestsOf = async (companyId: string) =>
    (await tenancy.withTenant(companyId, (tx) => tx.execute(sql`select id, source from app.requests order by created_at`))).rows as Array<{ id: string; source: string }>;
  const adminActor = async (): Promise<Actor> =>
    (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
  const pdf = () => ({ name: "anfrage.pdf", bytes: new TextEncoder().encode("%PDF-1.7\n% synthetic guest upload\n") });

  beforeAll(async () => {
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
    storage = new S3BlobStore(loadConfig().storage);
    boss = await createJobQueue(loadConfig().databaseUrl);
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    storage.destroy();
    await stack.close();
  });

  it("creates a guest company of its own with a signed-in guest member and the prepared samples", async () => {
    const { actor, setCookies } = await createGuestAccount(stack.database.db, stack.auth, { maxPerDay: 10_000, maxPerClient: 10_000, clientKey: unique("client") });

    expect(actor.role).toBe("guest");
    expect(setCookies.some((line) => line.includes("session_token"))).toBe(true);
    const company = await getCompany(stack.database.db, actor.companyId);
    expect(company?.slug.startsWith(GUEST_SLUG_PREFIX)).toBe(true);
    expect(await requestsOf(actor.companyId)).toEqual([]);

    const { seeded } = await seedSamples(deps(), actor);
    expect(seeded.length).toBeGreaterThan(0);
    const rows = await requestsOf(actor.companyId);
    expect(rows.length).toBe(seeded.length);
    expect(rows.every((row) => row.source === "sample")).toBe(true);
  });

  it("keeps guests apart: another company and another guest see none of the guest's requests", async () => {
    const first = await createGuestAccount(stack.database.db, stack.auth, { maxPerDay: 10_000, maxPerClient: 10_000, clientKey: unique("client") });
    const second = await createGuestAccount(stack.database.db, stack.auth, { maxPerDay: 10_000, maxPerClient: 10_000, clientKey: unique("client") });
    await seedSamples(deps(), first.actor);

    expect(first.actor.companyId).not.toBe(second.actor.companyId);
    expect((await requestsOf(first.actor.companyId)).length).toBeGreaterThan(0);
    expect(await requestsOf(second.actor.companyId)).toEqual([]);
  });

  it("refuses own uploads of a guest (they would start live model calls), staff still upload", async () => {
    const { actor: guest } = await createGuestAccount(stack.database.db, stack.auth, { maxPerDay: 10_000, maxPerClient: 10_000, clientKey: unique("client") });
    await expect(submitUpload({ tenancy, storage, boss, limits: loadConfig().upload }, guest, [pdf()])).rejects.toBeInstanceOf(AuthorizationError);
    expect(await requestsOf(guest.companyId)).toEqual([]);

    const admin = await adminActor();
    await expect(submitUpload({ tenancy, storage, boss, limits: loadConfig().upload }, admin, [pdf()])).resolves.toHaveProperty("requestId");
  });

  it("never lets an admin hand out the guest role", async () => {
    const admin = await adminActor();
    await expect(inviteUser(stack.database.db, admin, { email: "someone@example.com", role: "guest" })).rejects.toThrow("unknown role");
  });

  it("stops creating guests above the daily cap", async () => {
    await createGuestAccount(stack.database.db, stack.auth, { maxPerDay: 10_000, maxPerClient: 10_000, clientKey: unique("client") });
    await expect(createGuestAccount(stack.database.db, stack.auth, { maxPerDay: 1, maxPerClient: 10_000, clientKey: unique("client") })).rejects.toBeInstanceOf(GuestLimitReached);
  });

  const admissionsToday = async () =>
    ((await stack.database.db.execute(sql`select count(*)::int as n from identity.guest_admission where created_at > now() - interval '24 hours'`)).rows[0] as { n: number }).n;

  it("holds the daily cap under concurrent starts: never more guests than the cap (atomic in the database)", async () => {
    const maxPerDay = (await admissionsToday()) + 2;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createGuestAccount(stack.database.db, stack.auth, { maxPerDay, maxPerClient: 10_000, clientKey: unique("client") })),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(refused).toHaveLength(4);
    expect(refused.every((result) => result.reason instanceof GuestLimitReached)).toBe(true);
    expect(await admissionsToday()).toBe(maxPerDay);
  });

  it("brakes a single client: at most maxPerClient guests per client and 24 h, others still get in", async () => {
    const clientKey = unique("client");
    const start = (key: string) => createGuestAccount(stack.database.db, stack.auth, { maxPerDay: 10_000, maxPerClient: 2, clientKey: key });
    const results = await Promise.allSettled([start(clientKey), start(clientKey), start(clientKey), start(clientKey)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((result) => result.status === "rejected" && result.reason instanceof GuestClientLimitReached)).toHaveLength(2);
    await expect(start(unique("client"))).resolves.toHaveProperty("actor");
  });
});
