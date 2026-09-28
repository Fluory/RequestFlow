// One row of the request list (#26): which attempts, cause, stage and next retry to show. Pure – the
// page renders it; tested with fixtures. Only failing or retrying requests show a cause, so an old
// error never lingers on a request that moved on (e.g. REVIEW, REJECTED).
export interface RowRequest {
  status: string;
  attempts: number;
  errorStage: string | null;
  errorMessage: string | null;
  nextRetryAt: Date | null;
}

export interface RowExport {
  attempts: number;
  lastError: string | null;
}

export interface RowView {
  attempts: number;
  stage: "processing" | "export" | null;
  error: string | null;
  nextRetryAt: Date | null;
}

export function requestRowView(request: RowRequest, exportRecord: RowExport | undefined): RowView {
  const quiet: RowView = { attempts: request.attempts, stage: null, error: null, nextRetryAt: null };
  if (request.status === "ERROR") {
    const stage = request.errorStage === "export" ? "export" : "processing";
    return { attempts: stage === "export" ? (exportRecord?.attempts ?? request.attempts) : request.attempts, stage, error: request.errorMessage, nextRetryAt: null };
  }
  if ((request.status === "NEW" || request.status === "PROCESSING") && request.errorMessage) {
    return { attempts: request.attempts, stage: "processing", error: request.errorMessage, nextRetryAt: request.nextRetryAt };
  }
  // While the export retries the request stays APPROVED; its cause lives on the export record.
  if (request.status === "APPROVED" && exportRecord?.lastError) {
    return { attempts: exportRecord.attempts, stage: "export", error: exportRecord.lastError, nextRetryAt: request.nextRetryAt };
  }
  return quiet;
}

export interface NextAction {
  label: string;
  /** `todo`: a clerk has to act; `waiting`: the system is working on it. */
  kind: "todo" | "waiting";
}

/**
 * The next work decision per row (#77): what a clerk has to do, or what the system is doing – null when
 * the request is settled. An undecided possible duplicate comes before its review (#27: approval needs it).
 */
export function nextAction(
  request: RowRequest & { possibleDuplicate: boolean; duplicateDecision: string | null },
  exportRecord: RowExport | undefined,
): NextAction | null {
  const undecidedDuplicate = request.possibleDuplicate && request.duplicateDecision === null;
  switch (request.status) {
    case "REVIEW":
      return { label: undecidedDuplicate ? "Duplikat entscheiden" : "Prüfen", kind: "todo" };
    case "NEW":
      if (undecidedDuplicate) return { label: "Duplikat entscheiden", kind: "todo" };
      return { label: request.errorMessage ? "Wartet auf neuen Versuch" : "Wird ausgewertet", kind: "waiting" };
    case "PROCESSING":
      return { label: request.errorMessage ? "Wartet auf neuen Versuch" : "Wird ausgewertet", kind: "waiting" };
    case "APPROVED":
      return { label: exportRecord?.lastError ? "Export wird wiederholt" : "Export läuft", kind: "waiting" };
    case "ERROR":
      return { label: "Fehler ansehen", kind: "todo" };
    default:
      return null;
  }
}
