import { after } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogs } from "@/features/observability";
import { handleDrainRequest, scheduleAfterResponse } from "./drain-request";

// `after()` is the Next.js runtime boundary (it needs a request scope): replaced by a recorder.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));

// The drain route's gate (#59): shared secret, constant-time comparison, feature off without a secret.
// The drain itself is injected here; tests/integration/drain.test.ts drains real queues.
const SECRET = "cron-secret-synthetic-0123456789";
const summary = { processing: { processed: 1, failed: 0, deadLettered: 0 }, exports: { exported: 1, failed: 0, deadLettered: 0 } };

describe("handleDrainRequest", () => {
  let lines: string[];
  let restore: () => void;
  const run = vi.fn(async () => summary);
  const call = (authorization: string | null, { cronSecret = SECRET as string | undefined, method = "GET" } = {}) =>
    handleDrainRequest(
      new Request("http://localhost:3000/api/jobs/drain", { method, headers: authorization === null ? {} : { authorization } }),
      { cronSecret, run },
    );

  beforeEach(() => {
    lines = [];
    restore = captureLogs(lines);
    run.mockClear();
  });
  afterEach(() => restore());

  it("answers 404 and drains nothing when CRON_SECRET is not configured (feature off)", async () => {
    const response = await call(`Bearer ${SECRET}`, { cronSecret: "" });

    expect(response.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["no Authorization header", null],
    ["a wrong secret", "Bearer cron-secret-synthetic-WRONG-000000"],
    ["a secret of a different length", "Bearer short"],
    ["the right secret without the Bearer scheme", SECRET],
    ["the right secret with another scheme", `Basic ${SECRET}`],
    ["an empty bearer", "Bearer "],
  ])("answers 401 and drains nothing for %s", async (_case, authorization) => {
    const response = await call(authorization);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(run).not.toHaveBeenCalled();
  });

  it("drains once with the right secret (GET for Vercel Cron and POST) and returns counts only", async () => {
    const get = await call(`Bearer ${SECRET}`);
    const post = await call(`Bearer ${SECRET}`, { method: "POST" });

    expect(get.status).toBe(200);
    expect(post.status).toBe(200);
    expect(await get.json()).toEqual(summary);
    expect(get.headers.get("cache-control")).toBe("no-store");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never writes the secret or the presented credential into the log", async () => {
    await call("Bearer presented-wrong-credential-0000");
    await call(`Bearer ${SECRET}`);

    const log = lines.join("\n");
    expect(log).not.toContain(SECRET);
    expect(log).not.toContain("presented-wrong-credential");
    expect(lines.some((line) => JSON.parse(line).event === "jobs.drain_unauthorized")).toBe(true);
  });

  it("answers 503 with a generic body when the drain fails and logs the error class only", async () => {
    run.mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED postgres://app_rw:pw@db"), { name: "ConnectionError" }));

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/ECONNREFUSED|postgres/);
    expect(lines.join("\n")).not.toMatch(/ECONNREFUSED|app_rw:pw/);
    expect(lines.some((line) => JSON.parse(line).code === "ConnectionError")).toBe(true);
  });
});

describe("scheduleAfterResponse (JOB_DRAIN_INLINE)", () => {
  const afterMock = vi.mocked(after);
  let lines: string[];
  let restore: () => void;

  beforeEach(() => {
    afterMock.mockReset();
    lines = [];
    restore = captureLogs(lines);
  });
  afterEach(() => restore());

  it("schedules nothing when the inline drain is off", () => {
    const run = vi.fn(async () => summary);

    scheduleAfterResponse(false, run);

    expect(afterMock).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("schedules exactly one drain after the response when it is on", async () => {
    const run = vi.fn(async () => summary);

    scheduleAfterResponse(true, run);

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled(); // not before the response is sent
    await (afterMock.mock.calls[0]![0] as () => Promise<void>)();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("swallows a failing drain and logs its class only", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("password authentication failed for user app_rw"), { name: "DatabaseError" });
    });

    scheduleAfterResponse(true, run);
    await expect((afterMock.mock.calls[0]![0] as () => Promise<void>)()).resolves.toBeUndefined();

    expect(lines.join("\n")).not.toMatch(/password|app_rw/);
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(expect.objectContaining({ event: "jobs.drain_failed", code: "DatabaseError" }));
  });
});
