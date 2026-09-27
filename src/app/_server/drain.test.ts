import { after } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Page-view trigger of the serverless drain (#70, #73 review): the wiring between the inline-drain switch,
// the run gate and `after()`. External boundaries are replaced – `after()` (needs a request scope), the
// runtime (database, storage) and the drain round (pg-boss); tests/integration/drain.test.ts drains real
// queues with the same round.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));
const runtime = { drainInline: true };
vi.mock("./runtime", () => ({
  getRuntime: () => ({ config: { jobs: { drainInline: runtime.drainInline } }, tenancy: {}, storage: {} }),
  getJobClient: async () => ({}),
}));
const round = { processing: { processed: 0, failed: 0, deadLettered: 0 }, exports: { exported: 0, failed: 0, deadLettered: 0 } };
const drainRound = vi.fn(async () => round);
vi.mock("@/job-drain", () => ({ buildJobDeps: () => ({}), drainRound: () => drainRound(), handledJobs: () => 0 }));

const afterMock = vi.mocked(after);
const runScheduled = (index: number) => (afterMock.mock.calls[index]![0] as () => Promise<void>)();

describe("drainOnPageView", () => {
  let drainOnPageView: () => void;

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T08:00:00Z") });
    vi.resetModules(); // the gate lives in the module: a fresh one per test
    afterMock.mockReset();
    drainRound.mockClear();
    runtime.drainInline = true;
    ({ drainOnPageView } = await import("./drain"));
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing without JOB_DRAIN_INLINE (local, worker-based production)", () => {
    runtime.drainInline = false;

    drainOnPageView();

    expect(afterMock).not.toHaveBeenCalled();
  });

  it("schedules one drain after the response and ignores a second view right away", async () => {
    drainOnPageView();
    drainOnPageView();

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(drainRound).not.toHaveBeenCalled(); // not before the response is sent
    await runScheduled(0);
    expect(drainRound).toHaveBeenCalledTimes(1);
  });

  it("starts no second drain while the first still runs, and the next one once it finished", async () => {
    drainOnPageView();
    vi.advanceTimersByTime(60_000);
    drainOnPageView();
    expect(afterMock).toHaveBeenCalledTimes(1);

    await runScheduled(0);
    drainOnPageView();

    expect(afterMock).toHaveBeenCalledTimes(2);
  });

  it("frees the gate when the drain fails, so later views can retry", async () => {
    drainRound.mockRejectedValueOnce(new Error("synthetic"));
    drainOnPageView();
    await runScheduled(0);
    vi.advanceTimersByTime(30_000);

    drainOnPageView();

    expect(afterMock).toHaveBeenCalledTimes(2);
  });
});
