import { describe, expect, it } from "vitest";
import { isSampleLeftover } from "./sample-leftover";

// #84 + #92 review: only what an aborted seed run leaves behind – never a decided sample, never an
// approved one whose export failed (it may already be in the ERP and can be exported again).
const sample = { source: "sample" as const, errorStage: null };

describe("isSampleLeftover", () => {
  it.each(["NEW", "PROCESSING"] as const)("counts a sample in %s", (status) => {
    expect(isSampleLeftover({ ...sample, status })).toBe(true);
  });

  it("counts a sample whose processing failed", () => {
    expect(isSampleLeftover({ ...sample, status: "ERROR", errorStage: "processing" })).toBe(true);
  });

  it("never counts an approved sample whose export failed", () => {
    expect(isSampleLeftover({ ...sample, status: "ERROR", errorStage: "export" })).toBe(false);
  });

  it.each(["REVIEW", "APPROVED", "EXPORTED", "REJECTED"] as const)("never counts a decided or settled sample (%s)", (status) => {
    expect(isSampleLeftover({ ...sample, status })).toBe(false);
  });

  it("never counts an upload, whatever its state", () => {
    for (const status of ["NEW", "PROCESSING", "ERROR"] as const) {
      expect(isSampleLeftover({ source: "upload", status, errorStage: "processing" })).toBe(false);
    }
  });
});
