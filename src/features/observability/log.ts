// Structured JSON log lines with correlation IDs only (ADR-0001 D10): the allowed keys are fixed, so
// document content or personal data cannot slip into a log line by accident. Full pino setup: #28.
export interface LogIds {
  requestId?: string;
  jobId?: string;
  companyId?: string;
  documentId?: string;
  attempt?: number;
}

export interface LogDetail {
  /** Stable machine-readable code, e.g. `ai.timeout`. Never free text from documents. */
  code?: string;
  status?: number;
  durationMs?: number;
  count?: number;
}

export type LogLevel = "info" | "warn" | "error";

export function logEvent(level: LogLevel, event: string, ids: LogIds = {}, detail: LogDetail = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...pick(ids), ...pick(detail) });
  (level === "error" ? console.error : console.log)(line);
}

function pick(values: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
