export type HealthCheck = () => Promise<void>;
export type CheckResult = "ok" | "failed";
/**
 * `starting` (#81): no answer within the time limit – for a scaled-to-zero container usually its cold
 * start, which the probe itself triggers; the next probe normally reads `ok`. An answered error is `failed`.
 */
export type DependencyResult = CheckResult | "starting";

export interface HealthReport {
  status: "ok" | "degraded";
  checks: Record<string, CheckResult>;
  /** Informational (#28): reachable or not – does not change the HTTP status (e.g. the optional AI profile). */
  dependencies?: Record<string, DependencyResult>;
  /** Informational (#28): jobs waiting per queue; null when unknown. */
  backlog?: Record<string, number | null>;
}

export interface HealthResult {
  httpStatus: 200 | 503;
  report: HealthReport;
}

// A check fails by throwing or by exceeding the time limit. Error details stay out of the
// report on purpose: /api/health is reachable without login and must not leak hosts or users.
export async function runHealthChecks(
  checks: Record<string, HealthCheck>,
  options: { timeoutMs: number; dependencies?: Record<string, HealthCheck>; backlog?: Record<string, () => Promise<number>> },
): Promise<HealthResult> {
  // A required check that does not answer in time has failed; an informational dependency is starting.
  const settleAll = <R extends string>(group: Record<string, HealthCheck>, onTimeout: R) =>
    Promise.all(
      Object.entries(group).map(async ([name, check]) => {
        const outcome = await settle(check, options.timeoutMs);
        return [name, outcome === "timeout" ? onTimeout : outcome] as const;
      }),
    );
  const [entries, dependencies, backlog] = await Promise.all([
    settleAll(checks, "failed" as const),
    options.dependencies ? settleAll(options.dependencies, "starting" as const) : undefined,
    options.backlog
      ? Promise.all(
          Object.entries(options.backlog).map(async ([name, gauge]) => {
            let value: number | null = null;
            await settle(async () => {
              value = await gauge();
            }, options.timeoutMs);
            return [name, value] as const;
          }),
        )
      : undefined,
  ]);
  const healthy = entries.every(([, result]) => result === "ok");
  const report: HealthReport = { status: healthy ? "ok" : "degraded", checks: Object.fromEntries(entries) };
  if (dependencies) report.dependencies = Object.fromEntries(dependencies);
  if (backlog) report.backlog = Object.fromEntries(backlog);
  return { httpStatus: healthy ? 200 : 503, report };
}

const TIMED_OUT = Symbol("timed out");
// Our own limit, or the probe's AbortSignal.timeout (a DOMException named TimeoutError).
const isTimeout = (error: unknown) => error === TIMED_OUT || (error instanceof Error && error.name === "TimeoutError");

async function settle(check: HealthCheck, timeoutMs: number): Promise<CheckResult | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(TIMED_OUT), timeoutMs);
  });
  try {
    await Promise.race([check(), timeout]);
    return "ok";
  } catch (error) {
    return isTimeout(error) ? "timeout" : "failed";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Memoises an informational check or gauge for `ttlMs` (#28 review): `/api/health` is public, so the
 * AI-service ping and the backlog counts run at most once per window, not per call.
 */
export function cachedFor<T>(ttlMs: number, load: () => Promise<T>, now: () => number = Date.now): () => Promise<T> {
  let entry: { at: number; value: Promise<T> } | undefined;
  return () => {
    if (!entry || now() - entry.at >= ttlMs) {
      const value = load();
      entry = { at: now(), value };
      // A failed load is not cached: the next call tries again.
      value.catch(() => {
        if (entry?.value === value) entry = undefined;
      });
    }
    return entry.value;
  };
}
