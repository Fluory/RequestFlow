import { sql } from "drizzle-orm";
import pg from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { createJobQueue } from "@/db/job-queue-client";
import { createErpMock, MemoryMockStore } from "@/features/erp-mock";
import { createErpClient } from "@/features/export";
import { createGuestAccount, getActor, getCompany, NotAGuestCompany, purgeGuestCompany, type Actor } from "@/features/identity";
import { drainGuestPurges, enqueueExpiredGuestPurges } from "@/features/jobs";
import { currentFieldValues, currentLineItemValues } from "@/features/review";
import { seedSamples, type SampleDeps } from "@/features/samples";
import { S3BlobStore } from "@/features/storage";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, unique, type Stack } from "./helpers/stack";

// Guest retention (ADR-0001 D7 amendment 2026-11-20) against real Postgres, pg-boss and S3: a guest company
// older than the retention period is deleted completely – every `app` row of the company (incl. the
// append-only audit trail), its stored documents and its identity rows – through the pg-boss queue.
// Younger guests and staff companies stay untouched.
const TOKEN = "local-dev-only-erp-token-0123456789";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("guest retention", () => {
  let stack: Stack;
  let tenancy: Tenancy;
  let storage: S3BlobStore;
  let boss: PgBoss;
  let rw: pg.Client;

  const sampleDeps = (): SampleDeps => {
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
  const newGuest = async (): Promise<Actor> => {
    const { actor } = await createGuestAccount(stack.database.db, stack.auth, { maxPerDay: 10_000, maxPerClient: 10_000, clientKey: unique("client") });
    await seedSamples(sampleDeps(), actor);
    return actor;
  };
  const age = async (companyId: string, ms: number) =>
    stack.database.db.execute(sql`update identity.organization set created_at = now() - make_interval(secs => ${ms / 1000}) where id = ${companyId}`);
  /** Rows of the company in EVERY table of schema `app` – new tables are covered without touching this test. */
  const appRows = async (companyId: string): Promise<Record<string, number>> => {
    const tables = (await stack.database.db.execute(sql`select tablename from pg_tables where schemaname = 'app' order by 1`)).rows as Array<{ tablename: string }>;
    const counts: Record<string, number> = {};
    await tenancy.withTenant(companyId, async (tx) => {
      for (const { tablename } of tables) {
        const [row] = (await tx.execute(sql.raw(`select count(*)::int as n from app."${tablename}"`))).rows as Array<{ n: number }>;
        counts[tablename] = row?.n ?? 0;
      }
    });
    return counts;
  };
  const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);
  const storageKeys = async (companyId: string) =>
    tenancy.withTenant(companyId, async (tx) => ((await tx.execute(sql`select storage_key from app.documents`)).rows as Array<{ storage_key: string }>).map((row) => row.storage_key));
  const identityRows = async (companyId: string, userId: string) =>
    ((await stack.database.db.execute(sql`
      select (select count(*) from identity.organization where id = ${companyId})::int
           + (select count(*) from identity.member where organization_id = ${companyId})::int
           + (select count(*) from identity.invitation where organization_id = ${companyId})::int
           + (select count(*) from identity.guest_admission where organization_id = ${companyId})::int
           + (select count(*) from identity."user" where id = ${userId})::int
           + (select count(*) from identity.session where user_id = ${userId})::int
           + (select count(*) from identity.account where user_id = ${userId})::int as n`)).rows[0] as { n: number }).n;

  beforeAll(async () => {
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
    storage = new S3BlobStore(loadConfig().storage);
    boss = await createJobQueue(loadConfig().databaseUrl);
    rw = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await rw.connect();
  });

  afterAll(async () => {
    await rw.end();
    await boss.stop({ graceful: false });
    storage.destroy();
    await stack.close();
  });

  it("deletes an expired guest company completely through the queue: app rows, stored documents, identity rows", async () => {
    const expired = await newGuest();
    const fresh = await newGuest();
    const staff = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
    const keys = await storageKeys(expired.companyId);
    expect(keys.length).toBeGreaterThan(0);
    expect(total(await appRows(expired.companyId))).toBeGreaterThan(0);
    const freshBefore = await appRows(fresh.companyId);
    await age(expired.companyId, DAY_MS + 60_000);
    await age(staff.companyId, 30 * DAY_MS);

    const queued = await enqueueExpiredGuestPurges({ db: stack.database.db, boss }, { retentionMs: DAY_MS });
    expect(queued).toBeGreaterThanOrEqual(1);
    const purge = (companyId: string) => purgeGuestCompany({ tenancy, storage }, companyId);
    let purged = 0;
    for (let round = 0; round < 5; round++) purged += (await drainGuestPurges({ boss, purge }, { maxJobs: 10 })).purged;
    expect(purged).toBeGreaterThanOrEqual(1);

    expect(await appRows(expired.companyId)).toEqual(Object.fromEntries(Object.keys(freshBefore).map((name) => [name, 0])));
    for (const key of keys) await expect(storage.get(key)).rejects.toThrow();
    expect(await identityRows(expired.companyId, expired.userId)).toBe(0);
    expect(await getCompany(stack.database.db, expired.companyId)).toBeNull();

    // Younger guest and staff company (however old) are untouched.
    expect(await appRows(fresh.companyId)).toEqual(freshBefore);
    for (const key of await storageKeys(fresh.companyId)) await expect(storage.get(key)).resolves.toBeInstanceOf(Uint8Array);
    expect(await getCompany(stack.database.db, staff.companyId)).not.toBeNull();
  });

  it("is idempotent: purging a company that is already gone does nothing", async () => {
    const guest = await newGuest();
    await purgeGuestCompany({ tenancy, storage }, guest.companyId);
    await expect(purgeGuestCompany({ tenancy, storage }, guest.companyId)).resolves.toBeUndefined();
  });

  it("refuses to purge a staff company", async () => {
    const staff = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
    await expect(purgeGuestCompany({ tenancy, storage }, staff.companyId)).rejects.toBeInstanceOf(NotAGuestCompany);
    expect(await getCompany(stack.database.db, staff.companyId)).not.toBeNull();
  });

  it("the database function only works inside the company's own tenant context and only for guest companies", async () => {
    const guest = await newGuest();
    const staff = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
    const before = await appRows(guest.companyId);

    await expect(rw.query("select app.purge_guest_company($1)", [guest.companyId])).rejects.toThrow(/not in the tenant context/);
    await rw.query("begin");
    await rw.query("select set_config('app.company_id', $1, true)", [staff.companyId]);
    await expect(rw.query("select app.purge_guest_company($1)", [guest.companyId])).rejects.toThrow(/not in the tenant context/);
    await rw.query("rollback");
    await rw.query("begin");
    await rw.query("select set_config('app.company_id', $1, true)", [staff.companyId]);
    await expect(rw.query("select app.purge_guest_company($1)", [staff.companyId])).rejects.toThrow(/not a guest company/);
    await rw.query("rollback");

    expect(await appRows(guest.companyId)).toEqual(before);
    // The append-only grants stay: outside the function the runtime role still cannot delete audit rows.
    await expect(rw.query("delete from app.audit_events where company_id = $1", [guest.companyId])).rejects.toThrow(/permission denied/);
  });
});
