import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { createJobQueue } from "@/db/job-queue-client";
import { getActor, type Actor } from "@/features/identity";
import { QUEUES } from "@/features/jobs";
import { getRequest } from "@/features/requests";
import { loadReview } from "@/features/review";
import { RECORDED_MODEL_PREFIX, seedSamples } from "@/features/samples";
import { S3BlobStore } from "@/features/storage";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, type Stack } from "./helpers/stack";

// Prepared samples (#71) against real Postgres, pg-boss and S3: the real intake, processing and approval
// paths, with the extraction replayed from the committed recordings – no AI service is running here.
describe("prepared samples", () => {
  let stack: Stack;
  let tenancy: Tenancy;
  let storage: S3BlobStore;
  let boss: PgBoss;
  let admin: Actor;
  const deps = () => ({ tenancy, storage, boss, limits: { ...loadConfig().upload, maxPerHour: undefined } });
  const jobsFor = async (queue: string, requestId: string) =>
    (await stack.database.pool.query("select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2", [queue, requestId])).rows[0].n as number;

  beforeAll(async () => {
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
    storage = new S3BlobStore(loadConfig().storage);
    boss = await createJobQueue(loadConfig().databaseUrl);
    admin = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!;
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    storage.destroy();
    await stack.close();
  });

  it("seeds one sample in review and one approved sample whose export is queued – without a processing job", async () => {
    const seeded = await seedSamples(deps(), admin);

    expect(seeded.map(({ key, status }) => [key, status])).toEqual([
      ["werk-ost", "REVIEW"],
      ["pumpe-p204", "APPROVED"],
    ]);
    const [review, exported] = seeded.map((sample) => sample.requestId) as [string, string];

    const view = await loadReview(tenancy, admin, review);
    expect(view?.request).toMatchObject({ status: "REVIEW", source: "sample", possibleDuplicate: false });
    const statuses = view!.fields.map((field) => field.status);
    expect(statuses).toContain("uncertain");
    expect(statuses).toContain("missing");
    expect(view!.lineItems.length).toBeGreaterThan(0);
    // The original is stored like any upload, so "Original öffnen" works.
    expect(new TextDecoder().decode(await storage.get(view!.documents[0]!.storageKey))).toContain("Subject: Anfrage Rohrbogen und Flansche fuer Werk Ost");

    const runs = await stack.database.pool.query("select model_id from app.extraction_runs where request_id = any($1::uuid[])", [[review, exported]]);
    expect(runs.rows.map((row) => row.model_id as string).every((id) => id.startsWith(RECORDED_MODEL_PREFIX))).toBe(true);

    expect((await tenancy.withTenant(admin.companyId, (tx) => getRequest(tx, exported)))).toMatchObject({ status: "APPROVED", source: "sample" });
    expect(await jobsFor(QUEUES.exportRequest, exported)).toBe(1);
    // Processing ran inline with the recording: nothing a drain could send to the live model.
    expect(await jobsFor(QUEUES.processRequest, review)).toBe(0);
    expect(await jobsFor(QUEUES.processRequest, exported)).toBe(0);
  });

  it("is idempotent: a second run creates nothing while the samples still serve", async () => {
    const before = await tenancy.withTenant(admin.companyId, (tx) => tx.execute(sql`select count(*)::int as n from app.requests where source = 'sample'`));

    expect(await seedSamples(deps(), admin)).toEqual([]);

    const after = await tenancy.withTenant(admin.companyId, (tx) => tx.execute(sql`select count(*)::int as n from app.requests where source = 'sample'`));
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("the database refuses an unknown request source (migration 0019)", async () => {
    await expect(
      tenancy.withTenant(admin.companyId, (tx) => tx.execute(sql`update app.requests set source = 'mailbox' where company_id = ${admin.companyId}`)),
    ).rejects.toThrow();
  });
});
