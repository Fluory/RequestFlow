import { describe, expect, it } from "vitest";
import { runHealthChecks } from "./health";

const ok = async () => {};
const failing = async () => {
  throw new Error("connect ECONNREFUSED 10.0.0.5:5432 user=app_rw");
};
const hanging = () => new Promise<void>(() => {});

describe("runHealthChecks", () => {
  it("reports 200 and ok for every check when all checks pass", async () => {
    const result = await runHealthChecks({ database: ok, storage: ok }, { timeoutMs: 100 });

    expect(result.httpStatus).toBe(200);
    expect(result.report).toEqual({ status: "ok", checks: { database: "ok", storage: "ok" } });
  });

  it("reports 503 and names the failed check when one check throws", async () => {
    const result = await runHealthChecks({ database: failing, storage: ok }, { timeoutMs: 100 });

    expect(result.httpStatus).toBe(503);
    expect(result.report).toEqual({ status: "degraded", checks: { database: "failed", storage: "ok" } });
  });

  it("counts a check that exceeds its time limit as failed", async () => {
    const result = await runHealthChecks({ database: ok, storage: hanging }, { timeoutMs: 20 });

    expect(result.httpStatus).toBe(503);
    expect(result.report.checks.storage).toBe("failed");
  });

  it("never exposes error details such as hosts or user names", async () => {
    const result = await runHealthChecks({ database: failing }, { timeoutMs: 100 });

    expect(JSON.stringify(result.report)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|app_rw/);
  });
});
