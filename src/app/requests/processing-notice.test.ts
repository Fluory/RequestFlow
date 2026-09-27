import { describe, expect, it } from "vitest";
import { processingNotice } from "./processing-notice";
import { requestRowView, type RowRequest } from "./row-view";

// #70: the detail page tells the same story as the list – it is derived from the same row view (#73
// review), so a failed attempt waiting for its retry is never "being evaluated".
const time = (date: Date) => date.toISOString().slice(11, 16);
const now = new Date("2026-09-27T08:00:00Z");
const base: RowRequest = { status: "PROCESSING", attempts: 0, errorStage: null, errorMessage: null, nextRetryAt: null };
const notice = (request: Partial<RowRequest>) => {
  const row = { ...base, ...request };
  return processingNotice(row.status, requestRowView(row, undefined), time, now);
};

describe("processingNotice", () => {
  it("reports ongoing work while no attempt has failed", () => {
    expect(notice({})).toEqual({ tone: "info", text: "Die Dokumente werden gerade ausgewertet." });
  });

  it("shows the last error, the attempts and the next retry of a failed attempt", () => {
    expect(notice({ attempts: 2, errorMessage: "Der KI-Dienst ist nicht erreichbar.", nextRetryAt: new Date("2026-09-27T08:15:00Z") })).toEqual({
      tone: "warning",
      text: "Letzter Versuch fehlgeschlagen: Der KI-Dienst ist nicht erreichbar. Bisher 2 Versuche. Nächster Versuch: 08:15.",
    });
  });

  it("says a retry is due once its time has passed", () => {
    expect(notice({ attempts: 1, errorMessage: "Der KI-Dienst ist nicht erreichbar.", nextRetryAt: new Date("2026-09-27T07:55:00Z") })?.text).toBe(
      "Letzter Versuch fehlgeschlagen: Der KI-Dienst ist nicht erreichbar. Bisher 1 Versuch. Nächster Versuch fällig seit 07:55.",
    );
  });

  it("promises no retry when none is scheduled (e.g. attempts used up) – like the list, which shows none", () => {
    expect(notice({ attempts: 3, errorMessage: "Zeitüberschreitung beim KI-Dienst.", nextRetryAt: null })?.text).toBe(
      "Letzter Versuch fehlgeschlagen: Zeitüberschreitung beim KI-Dienst. Bisher 3 Versuche.",
    );
  });

  it("shows a failed attempt of a request that is still NEW, as the list does", () => {
    expect(notice({ status: "NEW", attempts: 1, errorMessage: "Der KI-Dienst ist nicht erreichbar." })?.tone).toBe("warning");
  });

  it("has nothing to say for a NEW request without a failed attempt or outside of processing", () => {
    expect(notice({ status: "NEW" })).toBeNull();
    for (const status of ["REVIEW", "APPROVED", "EXPORTED", "REJECTED", "ERROR"]) {
      expect(notice({ status, attempts: 1, errorMessage: "egal" })).toBeNull();
    }
  });
});
