// A processing job must finish before pg-boss considers it expired – otherwise it is redelivered
// while still running (double AI calls, a late result thrown away). Worst case per request:
// every document hits the AI timeout. Checked at worker start (fail-closed).
export const PROCESS_EXPIRE_SECONDS = 60 * 60;
const MARGIN_MS = 5 * 60 * 1000; // storage reads, persistence, clock skew

export function assertProcessingBudget(settings: { aiTimeoutMs: number; maxFiles: number }): void {
  const worstCaseMs = settings.aiTimeoutMs * settings.maxFiles + MARGIN_MS;
  if (worstCaseMs >= PROCESS_EXPIRE_SECONDS * 1000) {
    throw new Error("Invalid or missing configuration: AI_SERVICE_TIMEOUT_MS × UPLOAD_MAX_FILES exceeds the job expiry");
  }
}
