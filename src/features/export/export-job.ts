import { recordAudit } from "@/features/audit";
import { QUEUES, type JobRunner, type RequestJob } from "@/features/jobs";
import { logEvent } from "@/features/observability";
import { canTransition, lockRequest, recordExportRetry, transitionRequest } from "@/features/requests";
import type { Tenancy } from "@/features/tenancy";
import { ErpExportError, type ErpExporter } from "./erp-client";
import { buildQuoteRequest, ExportNotPossible, type FieldValues, type LineItemValues } from "./payload";
import { ensureExportRecord, markExportSucceeded, recordExportAttemptFailure } from "./repository";

// Export handler (ADR-0001 D9). Exactly once from three guards together:
// 1. the request row lock – held from the status check to the APPROVED → EXPORTED transition, across
//    the (time-bounded) ERP call, so concurrent deliveries of the same job serialise;
// 2. unique(request_id) on request_exports – one export record per request;
// 3. Idempotency-Key = requestId – the ERP answers a retry after an unknown outcome with the SAME
//    reference instead of creating a second record.
export interface ExportDeps {
  tenancy: Tenancy;
  erp: ErpExporter;
  fieldValues: FieldValues;
  /** Reviewed positions (#46) – required, so no caller drops them silently. */
  lineItemValues: LineItemValues;
}

export interface ExportDrainDeps extends ExportDeps {
  boss: Pick<JobRunner, "fetch" | "complete" | "fail" | "getJobById">;
}

export interface ExportDrainOptions {
  maxMs: number;
  /** Queue names – tests use dedicated queues with fast retries. */
  queues?: { export: string; dead: string };
}

export interface ExportDrainResult {
  exported: number;
  failed: number;
  deadLettered: number;
}

type Job = { id: string; data: RequestJob };

/** `skipped`: nothing to do – already EXPORTED, not approved, or not visible to this company. */
export async function exportRequestJob(deps: ExportDeps, job: Job): Promise<"exported" | "skipped"> {
  const { requestId, companyId } = job.data;
  return deps.tenancy.withTenant(companyId, async (tx) => {
    const request = await lockRequest(tx, requestId);
    if (!request || request.status !== "APPROVED") {
      // IDs and a reason code only – a wrong company in the payload shows up here as `not_visible`.
      logEvent("info", "export.skipped", { requestId, companyId, jobId: job.id }, { code: request ? `status_${request.status}` : "not_visible" });
      return "skipped";
    }
    await ensureExportRecord(tx, requestId);
    const payload = await buildQuoteRequest(tx, request, deps.fieldValues, deps.lineItemValues);
    const { receipt, replay } = await deps.erp.submit(payload);
    await markExportSucceeded(tx, requestId, receipt.erpReference);
    await transitionRequest(tx, request, "export.succeeded", { errorStage: null, errorMessage: null, nextRetryAt: null });
    await recordAudit(tx, {
      actorUserId: null,
      action: "request.exported",
      entityType: "request",
      entityId: requestId,
      data: { erpReference: receipt.erpReference, replay, jobId: job.id },
    });
    logEvent("info", "request.exported", { requestId, companyId, jobId: job.id });
    return "exported";
  });
}

/** Readable cause for staff – no hosts, tokens or payloads. */
export function describeExportFailure(error: unknown): string {
  if (error instanceof ErpExportError) {
    if (error.code === "timeout") return "ERP antwortet nicht (Zeitüberschreitung).";
    if (error.code === "unreachable") return "ERP nicht erreichbar.";
    if (error.code === "contract_violation") return "Die Antwort des ERP entspricht nicht dem vereinbarten Format.";
    return error.retryable ? `ERP vorübergehend nicht verfügbar (HTTP ${error.status}).` : `ERP hat den Export abgelehnt (HTTP ${error.status}).`;
  }
  if (error instanceof ExportNotPossible) return "Die Anfrage kann so nicht exportiert werden (Daten passen nicht zum ERP-Format).";
  return "Unerwarteter Fehler beim Export.";
}

const isPermanent = (error: unknown) => error instanceof ExportNotPossible || (error instanceof ErpExportError && !error.retryable);

/**
 * Processes export jobs until the budget is used up or no job is left. Like `drain()` for processing:
 * one dead-lettered job and one export job per round.
 */
export async function drainExports(deps: ExportDrainDeps, options: ExportDrainOptions): Promise<ExportDrainResult> {
  const queues = options.queues ?? { export: QUEUES.exportRequest, dead: QUEUES.exportRequestDead };
  const deadline = Date.now() + options.maxMs;
  const result: ExportDrainResult = { exported: 0, failed: 0, deadLettered: 0 };

  while (Date.now() < deadline) {
    const [dead] = await deps.boss.fetch<RequestJob>(queues.dead);
    if (dead) {
      try {
        await markExportError(deps.tenancy, dead, null);
        await deps.boss.complete(queues.dead, dead.id);
        result.deadLettered++;
      } catch (error) {
        logEvent("error", "dead_letter.failed", { requestId: dead.data.requestId, companyId: dead.data.companyId, jobId: dead.id }, { code: error instanceof Error ? error.name : "unknown" });
        await deps.boss.fail(queues.dead, dead.id);
      }
    }
    const [job] = await deps.boss.fetch<RequestJob>(queues.export);
    if (job) {
      if (await runExportJob(deps, queues.export, job)) result.exported++;
      else result.failed++;
    }
    if (!dead && !job) break;
  }
  return result;
}

async function runExportJob(deps: ExportDrainDeps, queue: string, job: Job): Promise<boolean> {
  const ids = { requestId: job.data.requestId, companyId: job.data.companyId, jobId: job.id };
  try {
    await exportRequestJob(deps, job);
    await deps.boss.complete(queue, job.id);
    return true;
  } catch (error) {
    const cause = describeExportFailure(error);
    const code = error instanceof ErpExportError ? `erp.${error.code}` : error instanceof ExportNotPossible ? "not_possible" : "unexpected";
    logEvent("error", "export.failed", ids, { code, status: error instanceof ErpExportError ? error.status : undefined });
    // Bookkeeping must never abort the drain: a job with unusable IDs still ends in retry/dead letter.
    try {
      if (!(error instanceof ExportNotPossible)) await deps.tenancy.withTenant(job.data.companyId, (tx) => recordExportAttemptFailure(tx, job.data.requestId, cause));
    } catch (bookkeeping) {
      logEvent("error", "export.bookkeeping_failed", ids, { code: bookkeeping instanceof Error ? bookkeeping.name : "unknown" });
    }
    if (isPermanent(error)) {
      await markExportError(deps.tenancy, job, cause).catch((failure: unknown) =>
        logEvent("error", "export.bookkeeping_failed", ids, { code: failure instanceof Error ? failure.name : "unknown" }),
      );
      await deps.boss.complete(queue, job.id, { error: code });
      return false;
    }
    await deps.boss.fail(queue, job.id, { error: code });
    // The request list shows when the next attempt runs (#26) – bookkeeping only, never aborts.
    try {
      const updated = await deps.boss.getJobById(queue, job.id);
      const nextRetryAt = updated?.state === "retry" && updated.startAfter ? new Date(updated.startAfter) : null;
      await deps.tenancy.withTenant(job.data.companyId, (tx) => recordExportRetry(tx, job.data.requestId, nextRetryAt));
    } catch (bookkeeping) {
      logEvent("error", "export.bookkeeping_failed", ids, { code: bookkeeping instanceof Error ? bookkeeping.name : "unknown" });
    }
    return false;
  }
}

/** APPROVED → ERROR (stage export) with a readable cause and an audit event. */
async function markExportError(tenancy: Tenancy, job: Job, cause: string | null): Promise<void> {
  const { requestId, companyId } = job.data;
  await tenancy.withTenant(companyId, async (tx) => {
    const request = await lockRequest(tx, requestId);
    if (!request || !canTransition(request.status, "export.failed")) return;
    const record = await ensureExportRecord(tx, requestId);
    const message = cause ?? (record.lastError ? `${record.lastError} Der Export ist nach mehreren Versuchen abgebrochen.` : "Der Export ist nach mehreren Versuchen fehlgeschlagen.");
    await transitionRequest(tx, request, "export.failed", { errorStage: "export", errorMessage: message, nextRetryAt: null });
    await recordAudit(tx, { actorUserId: null, action: "request.failed", entityType: "request", entityId: requestId, data: { stage: "export", jobId: job.id, attempts: record.attempts } });
  });
  logEvent("warn", "request.error", { requestId, companyId, jobId: job.id });
}
