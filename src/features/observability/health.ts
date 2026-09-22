export type HealthCheck = () => Promise<void>;
export type CheckResult = "ok" | "failed";

export interface HealthReport {
  status: "ok" | "degraded";
  checks: Record<string, CheckResult>;
}

export interface HealthResult {
  httpStatus: 200 | 503;
  report: HealthReport;
}

// A check fails by throwing or by exceeding the time limit. Error details stay out of the
// report on purpose: /api/health is reachable without login and must not leak hosts or users.
export async function runHealthChecks(
  checks: Record<string, HealthCheck>,
  options: { timeoutMs: number },
): Promise<HealthResult> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => [name, await settle(check, options.timeoutMs)] as const),
  );
  const results = Object.fromEntries(entries);
  const healthy = entries.every(([, result]) => result === "ok");
  return {
    httpStatus: healthy ? 200 : 503,
    report: { status: healthy ? "ok" : "degraded", checks: results },
  };
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
