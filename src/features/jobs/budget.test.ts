import { describe, expect, it } from "vitest";
import { assertProcessingBudget, PROCESS_EXPIRE_SECONDS } from "./budget";

describe("processing time budget vs. job expiry", () => {
  it("accepts the defaults: 10 documents × 120 s fit well inside the job expiry", () => {
    expect(() => assertProcessingBudget({ aiTimeoutMs: 120_000, maxFiles: 10 })).not.toThrow();
  });

  it("refuses a configuration where one request could outlive its job (pg-boss would redeliver it while it runs)", () => {
    const tooSlow = Math.ceil((PROCESS_EXPIRE_SECONDS * 1000) / 10);

    expect(() => assertProcessingBudget({ aiTimeoutMs: tooSlow, maxFiles: 10 })).toThrow(/AI_SERVICE_TIMEOUT_MS|UPLOAD_MAX_FILES/);
  });
});
