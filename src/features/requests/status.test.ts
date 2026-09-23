import { describe, expect, it } from "vitest";
import { InvalidTransition, nextStatus, type RequestEvent } from "./status";

describe("request status machine (ADR-0001: NEW → PROCESSING → REVIEW → APPROVED → EXPORTED, REJECTED, ERROR)", () => {
  it.each([
    ["NEW", "processing.started", "PROCESSING"],
    ["PROCESSING", "processing.started", "PROCESSING"], // redelivery after a crash
    ["PROCESSING", "processing.succeeded", "REVIEW"],
    ["NEW", "processing.failed", "ERROR"],
    ["PROCESSING", "processing.failed", "ERROR"],
    ["ERROR", "reprocess.processing", "NEW"],
    ["ERROR", "reprocess.export", "APPROVED"],
    ["REVIEW", "approve", "APPROVED"],
    ["REVIEW", "reject", "REJECTED"],
    ["APPROVED", "export.succeeded", "EXPORTED"],
    ["APPROVED", "export.failed", "ERROR"],
    // Duplicate decision (#27): before approval, never while a worker holds the request.
    ["NEW", "reject.duplicate", "REJECTED"],
    ["REVIEW", "reject.duplicate", "REJECTED"],
    ["ERROR", "reject.duplicate", "REJECTED"],
  ] as const)("%s --%s--> %s", (from, event, to) => {
    expect(nextStatus(from, event as RequestEvent)).toBe(to);
  });

  it.each([
    ["REVIEW", "processing.succeeded"],
    ["EXPORTED", "processing.started"],
    ["NEW", "approve"],
    ["PROCESSING", "approve"],
    ["APPROVED", "approve"],
    ["REJECTED", "approve"],
    ["EXPORTED", "export.succeeded"],
    ["REJECTED", "reprocess.processing"],
    ["REVIEW", "reprocess.processing"],
    ["EXPORTED", "reprocess.export"],
    ["PROCESSING", "reject.duplicate"],
    ["APPROVED", "reject.duplicate"],
    ["EXPORTED", "reject.duplicate"],
    ["REJECTED", "reject.duplicate"],
  ] as const)("refuses %s --%s", (from, event) => {
    expect(() => nextStatus(from, event as RequestEvent)).toThrow(InvalidTransition);
  });

  it("names both states in the error, never data", () => {
    expect(() => nextStatus("EXPORTED", "approve")).toThrow("EXPORTED --approve--> not allowed");
  });
});
