import { describe, expect, it } from "vitest";
import { nextAction, requestRowView } from "./row-view";

const base = { status: "NEW", attempts: 0, errorStage: null, errorMessage: null, nextRetryAt: null } as const;
const later = new Date("2026-09-23T10:00:00Z");

describe("request list row (#26)", () => {
  it("shows a processing retry: attempts, cause and next retry", () => {
    expect(requestRowView({ ...base, status: "PROCESSING", attempts: 2, errorMessage: "Der KI-Dienst ist nicht erreichbar.", nextRetryAt: later }, undefined)).toEqual({
      attempts: 2,
      stage: "processing",
      error: "Der KI-Dienst ist nicht erreichbar.",
      nextRetryAt: later,
    });
  });

  it("shows an export retry of an APPROVED request from its export record, with export attempts", () => {
    const record = { attempts: 3, lastError: "ERP nicht erreichbar." };
    expect(requestRowView({ ...base, status: "APPROVED", attempts: 1, nextRetryAt: later }, record)).toEqual({ attempts: 3, stage: "export", error: "ERP nicht erreichbar.", nextRetryAt: later });
  });

  it("counts export attempts for ERROR(export) and processing attempts for ERROR(processing)", () => {
    const record = { attempts: 8, lastError: "ERP vorübergehend nicht verfügbar (HTTP 503)." };
    expect(requestRowView({ ...base, status: "ERROR", attempts: 1, errorStage: "export", errorMessage: "ERP …" }, record)).toMatchObject({ attempts: 8, stage: "export" });
    expect(requestRowView({ ...base, status: "ERROR", attempts: 5, errorStage: "processing", errorMessage: "KI …" }, undefined)).toMatchObject({ attempts: 5, stage: "processing", nextRetryAt: null });
  });

  it("shows no error for requests that are not failing or retrying (e.g. a rejected duplicate with an old error)", () => {
    for (const status of ["REVIEW", "REJECTED", "EXPORTED"] as const) {
      expect(requestRowView({ ...base, status, attempts: 1, errorStage: "processing", errorMessage: "alt", nextRetryAt: later }, { attempts: 2, lastError: "alt" })).toEqual({
        attempts: 1,
        stage: null,
        error: null,
        nextRetryAt: null,
      });
    }
    expect(requestRowView({ ...base, status: "APPROVED", attempts: 1 }, undefined)).toEqual({ attempts: 1, stage: null, error: null, nextRetryAt: null });
  });
});

// #77: the list leads with the next work decision – what a clerk has to do, or what the system is doing.
describe("next action (#77)", () => {
  const row = (status: string, extra: Partial<Parameters<typeof nextAction>[0]> = {}) => ({ ...base, status, possibleDuplicate: false, duplicateDecision: null, ...extra });

  it.each([
    ["REVIEW", {}, { label: "Prüfen", kind: "todo" }],
    ["REVIEW", { possibleDuplicate: true, duplicateDecision: null }, { label: "Duplikat entscheiden", kind: "todo" }],
    ["REVIEW", { possibleDuplicate: true, duplicateDecision: "distinct" }, { label: "Prüfen", kind: "todo" }],
    ["NEW", { possibleDuplicate: true, duplicateDecision: null }, { label: "Duplikat entscheiden", kind: "todo" }],
    ["ERROR", {}, { label: "Fehler ansehen", kind: "todo" }],
    ["APPROVED", {}, { label: "Export läuft", kind: "waiting" }],
    ["NEW", {}, { label: "Wird ausgewertet", kind: "waiting" }],
    ["PROCESSING", {}, { label: "Wird ausgewertet", kind: "waiting" }],
    ["PROCESSING", { errorMessage: "Der KI-Dienst ist gerade ausgelastet." }, { label: "Wartet auf neuen Versuch", kind: "waiting" }],
  ] as const)("%s %o → %o", (status, extra, expected) => {
    expect(nextAction(row(status, extra as Partial<Parameters<typeof nextAction>[0]>), undefined)).toEqual(expected);
  });

  it("names a retrying export", () => {
    expect(nextAction(row("APPROVED"), { attempts: 2, lastError: "ERP nicht erreichbar." })).toEqual({ label: "Export wird wiederholt", kind: "waiting" });
  });

  it.each(["EXPORTED", "REJECTED"])("has nothing to do for a settled request (%s)", (status) => {
    expect(nextAction(row(status), undefined)).toBeNull();
  });
});
