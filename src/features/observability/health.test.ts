import { describe, expect, it } from "vitest";
import { cachedFor, runHealthChecks } from "./health";

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

  it("reports informational dependencies and backlog gauges without changing the HTTP status (#28)", async () => {
    const result = await runHealthChecks(
      { database: ok, storage: ok },
      { timeoutMs: 20, dependencies: { aiService: failing }, backlog: { "request-process": async () => 3, "request-export": async () => { throw new Error("x"); } } },
    );

    expect(result.httpStatus).toBe(200);
    expect(result.report).toEqual({
      status: "ok",
      checks: { database: "ok", storage: "ok" },
      dependencies: { aiService: "failed" },
      backlog: { "request-process": 3, "request-export": null },
    });
  });

  // #81: a dependency that does not answer in time is usually a scaled-to-zero container waking up
  // (the probe itself wakes it) – "starting", not "failed". An answered error stays "failed".
  it("reports a dependency without an answer in time as starting, not failed", async () => {
    const result = await runHealthChecks({ database: ok }, { timeoutMs: 20, dependencies: { aiService: hanging } });

    expect(result.httpStatus).toBe(200);
    expect(result.report.dependencies).toEqual({ aiService: "starting" });
  });

  it("also counts the probe's own timeout (AbortSignal.timeout) as starting", async () => {
    const aborted = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };

    const result = await runHealthChecks({ database: ok }, { timeoutMs: 100, dependencies: { aiService: aborted } });

    expect(result.report.dependencies).toEqual({ aiService: "starting" });
  });

  it("keeps a check (database, storage) that times out as failed with 503", async () => {
    const result = await runHealthChecks({ database: hanging }, { timeoutMs: 20, dependencies: { aiService: hanging } });

    expect(result.httpStatus).toBe(503);
    expect(result.report).toMatchObject({ status: "degraded", checks: { database: "failed" }, dependencies: { aiService: "starting" } });
  });

  it("times out a hanging gauge as unknown (null) and never leaks error text", async () => {
    const result = await runHealthChecks({ database: ok }, { timeoutMs: 20, backlog: { "request-process": () => new Promise<number>(() => {}) } });

    expect(result.report.backlog).toEqual({ "request-process": null });
    expect(JSON.stringify(result.report)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|app_rw/);
  });

  it("caches an informational load for its window and retries after a failure (cachedFor)", async () => {
    let clock = 0;
    let calls = 0;
    const load = cachedFor(10_000, async () => ++calls, () => clock);

    expect([await load(), await load()]).toEqual([1, 1]);
    clock = 10_000;
    expect(await load()).toBe(2);

    let failing = true;
    const flaky = cachedFor(10_000, async () => {
      calls++;
      if (failing) throw new Error("down");
      return 7;
    }, () => clock);
    await expect(flaky()).rejects.toThrow("down");
    failing = false;
    expect(await flaky()).toBe(7);
  });
});
