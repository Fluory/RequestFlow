import { describe, expect, it } from "vitest";
import { processingNotice } from "./processing-notice";

// #70: the detail page tells the same story as the list – a failed attempt waiting for its retry is
// not "being evaluated".
const time = (date: Date) => date.toISOString().slice(11, 16);
const base = { attempts: 0, errorMessage: null, nextRetryAt: null };

describe("processingNotice", () => {
  it("reports ongoing work while no attempt has failed", () => {
    expect(processingNotice({ ...base, status: "PROCESSING" }, time)).toEqual({
      tone: "info",
      text: "Die Dokumente werden gerade ausgewertet.",
    });
  });

  it("shows the last error, the attempts and the next retry of a failed attempt", () => {
    const notice = processingNotice(
      { status: "PROCESSING", attempts: 2, errorMessage: "Der KI-Dienst ist nicht erreichbar.", nextRetryAt: new Date("2026-09-27T08:15:00Z") },
      time,
    );

    expect(notice).toEqual({
      tone: "warning",
      text: "Letzter Versuch fehlgeschlagen: Der KI-Dienst ist nicht erreichbar. Nächster Versuch: 08:15 (bisher 2 Versuche).",
    });
  });

  it("uses the singular for one attempt and says a retry is planned when its time is unknown", () => {
    const notice = processingNotice({ status: "PROCESSING", attempts: 1, errorMessage: "Zeitüberschreitung beim KI-Dienst.", nextRetryAt: null }, time);

    expect(notice?.text).toBe("Letzter Versuch fehlgeschlagen: Zeitüberschreitung beim KI-Dienst. Ein neuer Versuch ist eingeplant (bisher 1 Versuch).");
  });

  it("has nothing to say outside of processing", () => {
    for (const status of ["NEW", "REVIEW", "APPROVED", "EXPORTED", "REJECTED", "ERROR"] as const) {
      expect(processingNotice({ ...base, status, errorMessage: "egal" }, time)).toBeNull();
    }
  });
});
