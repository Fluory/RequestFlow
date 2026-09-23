import type { RequestStatus } from "@/db/schema";

// The request status machine (ADR-0001 overview). Pure and test-first; every status change in a
// repository goes through `nextStatus`, so an illegal transition fails before it reaches the database.
export type RequestEvent =
  | "processing.started"
  | "processing.succeeded"
  | "processing.failed"
  | "reprocess.processing"
  | "approve"
  | "reject"
  | "export.succeeded"
  | "export.failed"
  | "reprocess.export";

export type ErrorStage = "processing" | "export";

const TRANSITIONS: Record<RequestEvent, Partial<Record<RequestStatus, RequestStatus>>> = {
  "processing.started": { NEW: "PROCESSING", PROCESSING: "PROCESSING" },
  "processing.succeeded": { PROCESSING: "REVIEW" },
  "processing.failed": { NEW: "ERROR", PROCESSING: "ERROR" },
  "reprocess.processing": { ERROR: "NEW" },
  approve: { REVIEW: "APPROVED" },
  reject: { REVIEW: "REJECTED" },
  "export.succeeded": { APPROVED: "EXPORTED" },
  "export.failed": { APPROVED: "ERROR" },
  "reprocess.export": { ERROR: "APPROVED" },
};

export class InvalidTransition extends Error {
  constructor(
    readonly from: RequestStatus,
    readonly event: RequestEvent,
  ) {
    super(`${from} --${event}--> not allowed`);
    this.name = "InvalidTransition";
  }
}

export function nextStatus(from: RequestStatus, event: RequestEvent): RequestStatus {
  const to = TRANSITIONS[event][from];
  if (!to) throw new InvalidTransition(from, event);
  return to;
}

export function canTransition(from: RequestStatus, event: RequestEvent): boolean {
  return TRANSITIONS[event][from] !== undefined;
}
