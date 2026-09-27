import type { RowView } from "./row-view";

// What the detail page says while a request is being processed (#70). Derived from the list's row view
// (#73 review), so list and detail show the same facts: last error, attempts, next retry.
export interface ProcessingNotice {
  tone: "info" | "warning";
  text: string;
}

export function processingNotice(status: string, row: RowView, formatTime: (date: Date) => string, now: Date = new Date()): ProcessingNotice | null {
  if (status !== "NEW" && status !== "PROCESSING") return null;
  if (!row.error) return status === "PROCESSING" ? { tone: "info", text: "Die Dokumente werden gerade ausgewertet." } : null;
  const attempts = `Bisher ${row.attempts} ${row.attempts === 1 ? "Versuch" : "Versuche"}.`;
  // No scheduled retry (e.g. attempts used up) → no promise; the list shows none either.
  const next = !row.nextRetryAt
    ? ""
    : row.nextRetryAt.getTime() <= now.getTime()
      ? ` Nächster Versuch fällig seit ${formatTime(row.nextRetryAt)}.`
      : ` Nächster Versuch: ${formatTime(row.nextRetryAt)}.`;
  return { tone: "warning", text: `Letzter Versuch fehlgeschlagen: ${row.error} ${attempts}${next}` };
}
