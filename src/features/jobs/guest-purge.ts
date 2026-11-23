import type { PgBoss } from "pg-boss";
import type { Database } from "@/db";
import { expiredGuestCompanies } from "@/features/identity";
import { logEvent } from "@/features/observability";
import { QUEUES, type GuestPurgeJob } from "./queues";

// Guest retention through the queue (ADR-0001 D4: pg-boss is the only queue; D7 amendment 2026-11-20).
// Every drain round (worker loop, serverless drain route/`after()`) sweeps for expired guest companies,
// enqueues one job per company (singletonKey = company) and runs a few of them.

export interface GuestSweepDeps {
  db: Database;
  boss: Pick<PgBoss, "send">;
}

export interface GuestPurgeRunner {
  boss: Pick<PgBoss, "fetch" | "complete" | "fail">;
  /** identity.purgeGuestCompany with its storage and tenancy wired in. */
  purge: (companyId: string) => Promise<void>;
}

const SWEEP_LIMIT = 50;

/** Enqueues a purge job for every guest company older than `retentionMs`; returns how many were queued. */
export async function enqueueExpiredGuestPurges(deps: GuestSweepDeps, options: { retentionMs: number; queue?: string }): Promise<number> {
  const queue = options.queue ?? QUEUES.purgeGuest;
  const ids = await expiredGuestCompanies(deps.db, { before: new Date(Date.now() - options.retentionMs), limit: SWEEP_LIMIT });
  let queued = 0;
  for (const companyId of ids) {
    const job: GuestPurgeJob = { companyId };
    // `exclusive` refuses a second job while one is queued or active – that is fine here (null id).
    if (await deps.boss.send(queue, job, { singletonKey: companyId })) queued++;
  }
  return queued;
}

/** Runs up to `maxJobs` purge jobs; a failing job is retried by pg-boss. */
export async function drainGuestPurges(deps: GuestPurgeRunner, options: { maxJobs: number; queue?: string }): Promise<{ purged: number; failed: number }> {
  const queue = options.queue ?? QUEUES.purgeGuest;
  const result = { purged: 0, failed: 0 };
  for (let index = 0; index < options.maxJobs; index++) {
    const [job] = await deps.boss.fetch<GuestPurgeJob>(queue);
    if (!job) break;
    try {
      await deps.purge(job.data.companyId);
      await deps.boss.complete(queue, job.id);
      logEvent("info", "guest.purged", { companyId: job.data.companyId, jobId: job.id });
      result.purged++;
    } catch (error) {
      logEvent("error", "guest.purge_failed", { companyId: job.data.companyId, jobId: job.id }, { code: error instanceof Error ? error.name : "unknown" });
      await deps.boss.fail(queue, job.id, { error: error instanceof Error ? error.name : "unknown" });
      result.failed++;
    }
  }
  return result;
}
