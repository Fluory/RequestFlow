import { SERVERLESS_DRAIN } from "@/config/env";
import { buildJobDeps, drainRound, handledJobs, type DrainRoundResult, type JobDeps } from "@/job-drain";
import { logEvent } from "@/features/observability";
import { scheduleAfterResponse } from "./drain-request";
import { getJobClient, getRuntime } from "./runtime";

// Serverless drain of the web process (#59, ADR-0001 D2): the showcase has no worker, so the route
// `/api/jobs/drain` (Vercel Cron, manual trigger) and `after()` following upload, approval and reprocess
// run one bounded round of the SAME handlers as src/worker.ts. Budgets: SERVERLESS_DRAIN (config).
let deps: Promise<JobDeps> | undefined;

function jobDeps(): Promise<JobDeps> {
  deps ??= getJobClient()
    .then((boss) => {
      const { config, tenancy, storage } = getRuntime();
      return buildJobDeps(config, { tenancy, storage, boss });
    })
    .catch((error: unknown) => {
      deps = undefined;
      throw error;
    });
  return deps;
}

/** One bounded round incl. pg-boss maintenance (no supervising worker here). */
export async function drainNow(): Promise<DrainRoundResult> {
  const started = Date.now();
  const result = await drainRound(await jobDeps(), {
    processMs: SERVERLESS_DRAIN.processMs,
    exportMs: SERVERLESS_DRAIN.exportMs,
    maintenance: true,
  });
  logEvent("info", "jobs.drain_run", {}, { count: handledJobs(result), durationMs: Date.now() - started });
  return result;
}

/** After upload, approval or reprocess: drain once after the response – only with JOB_DRAIN_INLINE=true. */
export function drainAfterResponse(): void {
  scheduleAfterResponse(getRuntime().config.jobs.drainInline, drainNow);
}
