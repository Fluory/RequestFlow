import pino, { type DestinationStream } from "pino";

// Structured JSON log lines (pino, #28) with correlation IDs only (ADR-0001 D10): the allowed keys are
// fixed by the types below, so document content or personal data cannot slip into a log line by
// accident. The correlation key across web → worker → AI service is the request id (`requestId`; sent
// to the AI service as `X-Request-Id`, which logs it too).
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

// Synchronous stdout: lines keep their order and nothing is lost when a process exits.
const stdout = () => pino.destination({ dest: 1, sync: true });

function createLogger(destination: DestinationStream) {
  return pino(
    {
      base: undefined,
      messageKey: "event",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}

let logger = createLogger(stdout());

export function logEvent(level: LogLevel, event: string, ids: LogIds = {}, detail: LogDetail = {}): void {
  logger[level]({ ...pick(ids), ...pick(detail) }, event);
}

/** Tests: route log lines into `lines` (JSON strings); call the returned function to restore stdout. */
export function captureLogs(lines: string[]): () => void {
  logger = createLogger({ write: (line: string) => void lines.push(line.trimEnd()) });
  return () => {
    logger = createLogger(stdout());
  };
}

function pick(values: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
