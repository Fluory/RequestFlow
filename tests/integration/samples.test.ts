import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { createJobQueue } from "@/db/job-queue-client";
import { listAuditEvents } from "@/features/audit";
import { createErpMock, MemoryMockStore } from "@/features/erp-mock";
import { createErpClient, exportRequestJob, getExportRecord } from "@/features/export";
import { getActor, type Actor } from "@/features/identity";
import { QUEUES, ReprocessRefused, reprocessRequest } from "@/features/jobs";
import { getRequest, lockRequest, transitionRequest } from "@/features/requests";
import { currentFieldValues, currentLineItemValues, loadReview } from "@/features/review";
import { RECORDED_MODEL_PREFIX, seedSamples, type SampleDeps } from "@/features/samples";
import { S3BlobStore } from "@/features/storage";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, type Stack } from "./helpers/stack";

// Prepared samples (#71) against real Postgres, pg-boss and S3: the real intake, processing, approval and
// export paths, with the extraction replayed from the committed recordings – no AI service is running.
// The ERP is the real mock module in-process (external boundary).
const TOKEN = "local-dev-only-erp-token-0123456789";

describe("prepared samples", () => {
  let stack: Stack;
  let tenancy: Tenancy;
  let storage: S3BlobStore;
  let boss: PgBoss;
  const actors: Actor[] = [];

  function deps(options: { erpDown?: boolean; storage?: SampleDeps["storage"] } = {}): SampleDeps {
    const mock = createErpMock({ token: TOKEN, store: new MemoryMockStore() });
    const fetchImpl: typeof fetch = async (input, init) => {
      if (options.erpDown) throw new TypeError("fetch failed"); // unreachable
      return mock.handle(new Request(input, init));
    };
    return {
      tenancy,
      storage: options.storage ?? storage,
      boss,
      limits: { ...loadConfig().upload, maxPerHour: undefined },
      export: { tenancy, erp: createErpClient({ baseUrl: "http://web/api/erp-mock", token: TOKEN, timeoutMs: 2_000, fetch: fetchImpl }), fieldValues: currentFieldValues, lineItemValues: currentLineItemValues },
    };
  }
  const jobsFor = async (queue: string, requestId: string) =>
    (await stack.database.pool.query("select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2", [queue, requestId])).rows[0].n as number;
  const samplesOf = async (actor: Actor) =>
    (await tenancy.withTenant(actor.companyId, (tx) => tx.execute(sql`select id, status from app.requests where source = 'sample' order by created_at`))).rows as Array<{ id: string; status: string }>;

  beforeAll(async () => {
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
    storage = new S3BlobStore(loadConfig().storage);
    boss = await createJobQueue(loadConfig().databaseUrl);
    for (let i = 0; i < 3; i++) actors.push((await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await companyWithAdmin(stack)).cookie })))!);
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    storage.destroy();
    await stack.close();
  });

  it("seeds one sample in review and one approved and exported sample; a later delivery of the export job is a no-op", async () => {
    const [admin] = actors as [Actor];
    const { seeded, retired } = await seedSamples(deps(), admin);

    expect(retired).toBe(0);
    expect(seeded.map(({ key, status }) => [key, status])).toEqual([
      ["werk-ost", "REVIEW"],
      ["pumpe-p204", "EXPORTED"],
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

    // AC: an ERP reference without any visitor action – export row, audit event, exactly once.
    const record = await tenancy.withTenant(admin.companyId, (tx) => getExportRecord(tx, exported));
    expect(record?.erpReference).toMatch(/^QR-[0-9A-F]{10}$/);
    expect((await tenancy.withTenant(admin.companyId, (tx) => getRequest(tx, exported)))).toMatchObject({ status: "EXPORTED", source: "sample" });
    const exportedEvents = (await tenancy.withTenant(admin.companyId, (tx) => listAuditEvents(tx, "request", exported))).filter((event) => event.action === "request.exported");
    expect(exportedEvents).toHaveLength(1);

    // Recorded runs: marked, and no tokens or model time counted as spent.
    // Inside the tenant: RLS returns no rows to a query without company context.
    const runs = await tenancy.withTenant(admin.companyId, (tx) =>
      tx.execute(sql`select model_id, total_tokens, latency_ms from app.extraction_runs where request_id in (${review}, ${exported})`),
    );
    expect(runs.rows).toHaveLength(2);
    for (const run of runs.rows) expect(run).toMatchObject({ total_tokens: 0, latency_ms: 0, model_id: expect.stringMatching(new RegExp(`^${RECORDED_MODEL_PREFIX}`)) });

    // Processing ran inline and was never queued: nothing a drain could send to the live model.
    for (const id of [review, exported]) expect(await jobsFor(QUEUES.processRequest, id)).toBe(0);
    // The approval queued its export job as always (#83 re-review); delivered later, it finds EXPORTED.
    expect(await jobsFor(QUEUES.exportRequest, exported)).toBe(1);
    expect(await exportRequestJob(deps().export, { id: "later-delivery", data: { requestId: exported, companyId: admin.companyId } })).toBe("skipped");
    expect(await tenancy.withTenant(admin.companyId, (tx) => getExportRecord(tx, exported))).toMatchObject({ erpReference: record!.erpReference });
  });

  it("is idempotent: a second run creates nothing while the samples still serve", async () => {
    const [admin] = actors as [Actor];
    const before = await samplesOf(admin);

    expect(await seedSamples(deps(), admin)).toEqual({ seeded: [], retired: 0 });

    expect(await samplesOf(admin)).toEqual(before);
  });

  it("leaves the export to the queued job when the ERP is unreachable – nothing half-written", async () => {
    const admin = actors[1]!;

    const { seeded } = await seedSamples(deps({ erpDown: true }), admin);

    const exported = seeded.find((sample) => sample.key === "pumpe-p204")!;
    expect(exported.status).toBe("APPROVED");
    expect((await tenancy.withTenant(admin.companyId, (tx) => getRequest(tx, exported.requestId)))?.status).toBe("APPROVED");
    expect(await jobsFor(QUEUES.exportRequest, exported.requestId)).toBe(1);
    expect(await tenancy.withTenant(admin.companyId, (tx) => getExportRecord(tx, exported.requestId))).toBeNull();
  });

  it("a sample whose export failed can still be exported again – only processing is refused (#83 re-review)", async () => {
    const admin = actors[1]!;
    const exported = (await samplesOf(admin)).find((sample) => sample.status === "APPROVED")!;
    // The export gave up (as the drain would after its retries); its queued job is gone.
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, exported.id]);
    await tenancy.withTenant(admin.companyId, async (tx) =>
      transitionRequest(tx, (await lockRequest(tx, exported.id))!, "export.failed", { errorStage: "export", errorMessage: "ERP nicht erreichbar." }),
    );

    await reprocessRequest({ tenancy, boss }, admin, exported.id);

    expect((await tenancy.withTenant(admin.companyId, (tx) => getRequest(tx, exported.id)))?.status).toBe("APPROVED");
    expect(await jobsFor(QUEUES.exportRequest, exported.id)).toBe(1);
  });

  it("keeps an approved sample whose export failed – it is no leftover (#92 review)", async () => {
    const admin = actors[1]!;
    const exported = (await samplesOf(admin)).find((sample) => sample.status === "APPROVED")!;
    await stack.database.pool.query("delete from pgboss.job where name = $1 and singleton_key = $2", [QUEUES.exportRequest, exported.id]);
    await tenancy.withTenant(admin.companyId, async (tx) =>
      transitionRequest(tx, (await lockRequest(tx, exported.id))!, "export.failed", { errorStage: "export", errorMessage: "ERP nicht erreichbar." }),
    );

    const { retired } = await seedSamples(deps(), admin);

    expect(retired).toBe(0);
    expect(await tenancy.withTenant(admin.companyId, (tx) => getRequest(tx, exported.id))).toMatchObject({ status: "ERROR", errorStage: "export" });
  });

  it("an aborted run leaves the sample in ERROR, not in progress; the next run replaces it; no live reprocess", async () => {
    const admin = actors[2]!;
    const brokenStorage = Object.assign(Object.create(storage) as S3BlobStore, {
      get: async () => {
        throw new Error("synthetic storage outage");
      },
    });

    await expect(seedSamples(deps({ storage: brokenStorage }), admin)).rejects.toThrow("synthetic storage outage");

    const [failed] = await samplesOf(admin);
    expect(failed).toMatchObject({ status: "ERROR" });
    // Reprocessing a sample would call the live model – refused.
    await expect(reprocessRequest({ tenancy, boss }, admin, failed!.id)).rejects.toBeInstanceOf(ReprocessRefused);

    const { seeded, retired } = await seedSamples(deps(), admin);
    expect(seeded.map(({ key, status }) => [key, status])).toEqual([
      ["werk-ost", "REVIEW"],
      ["pumpe-p204", "EXPORTED"],
    ]);

    // #84: the leftover is settled – rejected with a reason and an audit event, never deleted.
    expect(retired).toBe(1);
    expect(await tenancy.withTenant(admin.companyId, (tx) => getRequest(tx, failed!.id))).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Beispiel durch einen neuen Lauf ersetzt – das Anlegen war abgebrochen.",
      errorMessage: null,
    });
    const events = await tenancy.withTenant(admin.companyId, (tx) => listAuditEvents(tx, "request", failed!.id));
    expect(events.filter((event) => event.action === "request.sample_retired")).toHaveLength(1);
    expect((await samplesOf(admin)).map((sample) => sample.status).sort()).toEqual(["EXPORTED", "REJECTED", "REVIEW"]);
  });

  it("the database refuses an unknown request source (migration 0019)", async () => {
    const [admin] = actors as [Actor];

    await expect(
      tenancy.withTenant(admin.companyId, (tx) => tx.execute(sql`update app.requests set source = 'mailbox' where company_id = ${admin.companyId}`)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514", constraint: "requests_source_check" }) });
  });
});
