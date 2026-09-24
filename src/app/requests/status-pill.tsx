import { requestStatusLabel } from "./status-labels";

// Colour tone per request status (#52). The label text is always shown – colour only supports it.
const TONE: Record<string, string> = {
  NEW: "neutral",
  PROCESSING: "info",
  REVIEW: "warn",
  APPROVED: "success",
  EXPORTED: "success",
  REJECTED: "neutral",
  ERROR: "danger",
};

export function StatusPill({ status, testId }: { status: string; testId?: string }) {
  return (
    <span className={`pill pill-${TONE[status] ?? "neutral"}`} data-testid={testId}>
      {requestStatusLabel(status)}
    </span>
  );
}
