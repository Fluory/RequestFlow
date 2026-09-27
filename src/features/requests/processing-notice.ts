import type { RequestRow } from "./repository";

export interface ProcessingNotice {
  tone: "info" | "warning";
  text: string;
}

type NoticeInput = Pick<RequestRow, "status" | "attempts" | "errorMessage" | "nextRetryAt">;

/**
 * What the detail page says while a request is being processed (#70). A failed attempt that waits
 * for its retry is reported with the same facts as the request list: last error, attempts, next retry.
 */
export function processingNotice(request: NoticeInput, formatTime: (date: Date) => string): ProcessingNotice | null {
  if (request.status !== "PROCESSING") return null;
  if (!request.errorMessage) return { tone: "info", text: "Die Dokumente werden gerade ausgewertet." };
  const attempts = `bisher ${request.attempts} ${request.attempts === 1 ? "Versuch" : "Versuche"}`;
  const next = request.nextRetryAt ? `Nächster Versuch: ${formatTime(request.nextRetryAt)}` : "Ein neuer Versuch ist eingeplant";
  return { tone: "warning", text: `Letzter Versuch fehlgeschlagen: ${request.errorMessage} ${next} (${attempts}).` };
}
