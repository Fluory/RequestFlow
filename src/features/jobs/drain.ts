import type { PgBoss } from "pg-boss";
import { recordAudit } from "@/features/audit";
import { AiServiceError } from "@/features/extraction";
import { logEvent } from "@/features/observability";
import { canTransition, lockRequest, recordProcessingFailure, transitionRequest } from "@/features/requests";
import type { Tenancy } from "@/features/tenancy";
import { describeFailure, PermanentProcessingError, processRequestJob, type ProcessingDeps } from "./process-request";
import { QUEUES, type RequestJob } from "./queues";

export type JobRunner = Pick<PgBoss, "fetch" | "complete" | "fail" | "getJobById" | "supervise">;

export interface DrainDeps extends ProcessingDeps {
  boss: JobRunner;
}

export interface DrainOptions {
  /** Time budget; the current job always finishes. */
  maxMs: number;
  /** Queue names – tests use dedicated queues with fast retries. */
  queues?: { process: string; dead: string };
  /** Run pg-boss maintenance (expiry → retry, retention) once – for runtimes without a supervising worker. */
  maintenance?: boolean;
}

export interface DrainResult {
  processed: number;
  failed: number;
  deadLettered: number;
}

/**
 * Processes available jobs until the budget is used up or no job is left (ADR-0001 D2). The worker
 * calls it in a loop; a serverless runtime can call it after enqueueing or from a cron sweep.
 */
export async function drain(deps: DrainDeps, options: DrainOptions): Promise<DrainResult> {
  const queues = options.queues ?? { process: QUEUES.processRequest, dead: QUEUES.processRequestDead };
  const deadline = Date.now() + options.maxMs;
  const result: DrainResult = { processed: 0, failed: 0, deadLettered: 0 };
  if (options.maintenance) await deps.boss.supervise(queues.process);

  // Each round takes one dead-lettered job and one processing job, so errors become visible even
  // under steady load. A failing dead-letter handler throws: pg-boss retries it (queue settings).
  while (Date.now() < deadline) {
    const [dead] = await deps.boss.fetch<RequestJob>(queues.dead);
    if (dead) {
      try {
        await markError(deps.tenancy, dead.data, null, dead.id);
        await deps.boss.complete(queues.dead, dead.id);
        result.deadLettered++;
      } catch (error) {
        logEvent("error", "dead_letter.failed", { requestId: dead.data.requestId, companyId: dead.data.companyId, jobId: dead.id }, { code: error instanceof Error ? error.name : "unknown" });
        await deps.boss.fail(queues.dead, dead.id);
      }
    }
    const [job] = await deps.boss.fetch<RequestJob>(queues.process);
    if (job) {
      if (await runJob(deps, queues.process, job)) result.processed++;
      else result.failed++;
    }
    if (!dead && !job) break;
  }
  return result;
}

async function runJob(deps: DrainDeps, queue: string, job: { id: string; data: RequestJob }): Promise<boolean> {
  const ids = { requestId: job.data.requestId, companyId: job.data.companyId, jobId: job.id };
  try {
    await processRequestJob(deps, job);
    await deps.boss.complete(queue, job.id);
    return true;
  } catch (error) {
    const cause = describeFailure(error);
    const code = error instanceof AiServiceError ? `ai.${error.code}` : error instanceof PermanentProcessingError ? "permanent" : "unexpected";
    const permanent = error instanceof PermanentProcessingError || (error instanceof AiServiceError && !error.retryable);
    logEvent("error", "job.failed", ids, { code, status: error instanceof AiServiceError ? error.status : undefined });
    if (permanent) {
      // Retrying cannot help: visible ERROR now, job done (reprocess re-enqueues after a fix).
      await markError(deps.tenancy, job.data, cause, job.id);
      await deps.boss.complete(queue, job.id, { error: code });
      return false;
    }
    await deps.boss.fail(queue, job.id, { error: code });
    // Bookkeeping must never abort the drain: a job with unusable IDs (e.g. not a UUID) is already
    // failed above and ends in retry/dead letter like any other.
    try {
      const updated = await deps.boss.getJobById(queue, job.id);
      await deps.tenancy.withTenant(job.data.companyId, (tx) =>
        recordProcessingFailure(tx, job.data.requestId, {
          message: cause,
          nextRetryAt: updated?.state === "retry" && updated.startAfter ? new Date(updated.startAfter) : null,
        }),
      );
    } catch (bookkeeping) {
      logEvent("error", "job.bookkeeping_failed", ids, { code: bookkeeping instanceof Error ? bookkeeping.name : "unknown" });
    }
    return false;
  }
}

/** Moves a request to ERROR (stage processing) with a readable cause and an audit event. */
async function markError(tenancy: Tenancy, job: RequestJob, cause: string | null, jobId: string): Promise<void> {
  await tenancy.withTenant(job.companyId, async (tx) => {
    const request = await lockRequest(tx, job.requestId);
    if (!request || !canTransition(request.status, "processing.failed")) return;
    const message = cause ?? request.errorMessage ?? "Die Verarbeitung ist nach mehreren Versuchen fehlgeschlagen.";
    await transitionRequest(tx, request, "processing.failed", { errorStage: "processing", errorMessage: message, nextRetryAt: null });
    await recordAudit(tx, {
      actorUserId: null,
      action: "request.failed",
      entityType: "request",
      entityId: job.requestId,
      data: { stage: "processing", jobId, attempts: request.attempts },
    });
  });
  logEvent("warn", "request.error", { requestId: job.requestId, companyId: job.companyId, jobId });
}
