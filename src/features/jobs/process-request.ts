import { recordAudit } from "@/features/audit";
import { listDocuments } from "@/features/documents";
import { AiServiceError, persistExtractionRun, runExistsForJob, type AiServiceClient, type DocumentOutcome } from "@/features/extraction";
import { logEvent } from "@/features/observability";
import { canTransition, lockRequest, transitionRequest } from "@/features/requests";
import type { S3BlobStore } from "@/features/storage";
import type { Tenancy } from "@/features/tenancy";
import type { RequestJob } from "./queues";

export interface ProcessingDeps {
  tenancy: Tenancy;
  storage: Pick<S3BlobStore, "get">;
  ai: AiServiceClient;
}

/** A failure that retrying cannot fix; the request goes to ERROR at once with this cause. */
export class PermanentProcessingError extends Error {
  constructor(readonly cause_: string) {
    super(cause_);
    this.name = "PermanentProcessingError";
  }
}

// Formats the AI service accepts today; others are kept as originals but skipped (#23 adds them).
const AI_KINDS = new Set(["pdf", "eml"]);

/** Human-readable causes for staff (DR4): no stack traces, no hosts, no document content. */
export function describeFailure(error: unknown): string {
  if (error instanceof PermanentProcessingError) return error.cause_;
  if (error instanceof AiServiceError) {
    if (error.code === "timeout") return "Der KI-Dienst hat nicht rechtzeitig geantwortet.";
    if (error.retryable) return "Der KI-Dienst ist nicht erreichbar.";
    return "Der KI-Dienst hat die Anfrage abgelehnt – bitte die Administration informieren.";
  }
  return "Unerwarteter Fehler bei der Verarbeitung.";
}

/**
 * Processes one request job (ADR-0001 D4/D8): claim under a row lock, send each document's bytes to
 * the AI service, then persist run, segments and fields and move the request to REVIEW in ONE
 * transaction. Idempotent: a job whose run exists, or a request no longer NEW/PROCESSING, is a no-op.
 * Retryable failures throw (pg-boss retries with backoff); permanent ones throw PermanentProcessingError.
 */
export async function processRequestJob(deps: ProcessingDeps, job: { id: string; data: RequestJob }): Promise<"processed" | "skipped"> {
  const { requestId, companyId } = job.data;
  const ids = { requestId, companyId, jobId: job.id };

  const claimed = await deps.tenancy.withTenant(companyId, async (tx) => {
    const request = await lockRequest(tx, requestId);
    if (!request || (await runExistsForJob(tx, job.id)) || !canTransition(request.status, "processing.started")) return null;
    await transitionRequest(tx, request, "processing.started", { attempts: request.attempts + 1 });
    return listDocuments(tx, requestId);
  });
  if (!claimed) {
    logEvent("info", "job.skipped", ids);
    return "skipped";
  }

  const outcomes: DocumentOutcome[] = [];
  for (const document of claimed) {
    if (!AI_KINDS.has(document.kind)) {
      outcomes.push({ documentId: document.id, skipped: "unsupported_kind" });
      continue;
    }
    const bytes = await deps.storage.get(document.storageKey);
    try {
      const response = await deps.ai.extract({
        bytes,
        filename: document.filename,
        mediaType: document.contentType,
        documentId: document.id,
        correlationId: requestId,
      });
      outcomes.push({ documentId: document.id, response });
    } catch (error) {
      // One unreadable document does not fail the request; the others are still processed.
      if (error instanceof AiServiceError && !error.retryable && error.scope === "document") {
        logEvent("warn", "document.rejected", { ...ids, documentId: document.id }, { status: error.status });
        outcomes.push({ documentId: document.id, skipped: `rejected_${error.status ?? "unknown"}` });
        continue;
      }
      throw error;
    }
  }
  if (!outcomes.some((outcome) => outcome.response)) {
    throw new PermanentProcessingError("Kein Dokument dieser Anfrage konnte automatisch verarbeitet werden.");
  }

  const done = await deps.tenancy.withTenant(companyId, async (tx) => {
    const request = await lockRequest(tx, requestId);
    if (!request || request.status !== "PROCESSING" || (await runExistsForJob(tx, job.id))) return false;
    let runId: string | null;
    try {
      runId = await persistExtractionRun(tx, { requestId, jobId: job.id, outcomes });
    } catch (error) {
      // A constraint violation (23xxx) is a bad result, not a transient fault – retrying repeats it.
      if (/^23/.test(String((error as { cause?: { code?: unknown } }).cause?.code ?? (error as { code?: unknown }).code ?? ""))) {
        throw new PermanentProcessingError("Das Ergebnis des KI-Dienstes war unvollständig und wurde nicht übernommen.");
      }
      throw error;
    }
    if (!runId) return false;
    await transitionRequest(tx, request, "processing.succeeded", { errorStage: null, errorMessage: null, nextRetryAt: null });
    await recordAudit(tx, {
      actorUserId: null,
      action: "request.extracted",
      entityType: "request",
      entityId: requestId,
      data: { runId, jobId: job.id, documents: outcomes.length, processed: outcomes.filter((o) => o.response).length },
    });
    return true;
  });
  logEvent("info", done ? "job.processed" : "job.skipped", ids, { count: outcomes.length });
  return done ? "processed" : "skipped";
}
