export type HealthCheck = () => Promise<void>;
export type CheckResult = "ok" | "failed";

export interface HealthReport {
  status: "ok" | "degraded";
  checks: Record<string, CheckResult>;
  /** Informational (#28): reachable or not – does not change the HTTP status (e.g. the optional AI profile). */
  dependencies?: Record<string, CheckResult>;
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
  const settleAll = (group: Record<string, HealthCheck>) =>
    Promise.all(Object.entries(group).map(async ([name, check]) => [name, await settle(check, options.timeoutMs)] as const));
  const [entries, dependencies, backlog] = await Promise.all([
    settleAll(checks),
    options.dependencies ? settleAll(options.dependencies) : undefined,
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

async function settle(check: HealthCheck, timeoutMs: number): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    await Promise.race([check(), timeout]);
    return "ok";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
