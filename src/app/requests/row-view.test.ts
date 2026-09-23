import { describe, expect, it } from "vitest";
import { requestRowView } from "./row-view";

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
