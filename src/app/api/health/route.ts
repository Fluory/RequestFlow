import { getRuntime } from "@/app/_server/runtime";
import { pingDatabase } from "@/db";
import { runHealthChecks } from "@/features/observability";

export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 3_000;

// Public, unauthenticated: the report names checks and their state only – never hosts, users or
// error messages (ADR-0001 D10).
export async function GET(): Promise<Response> {
  let result;
  try {
    const { database, storage } = getRuntime();
    result = await runHealthChecks(
      { database: () => pingDatabase(database.pool), storage: () => storage.ping() },
      { timeoutMs: CHECK_TIMEOUT_MS },
    );
  } catch {
    // Invalid configuration: report degraded without revealing which variable is wrong.
    result = { httpStatus: 503 as const, report: { status: "degraded" as const, checks: { config: "failed" as const } } };
  }
  return Response.json(result.report, { status: result.httpStatus, headers: { "cache-control": "no-store" } });
}
