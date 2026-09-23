import { getRuntime } from "@/app/_server/runtime";
import { pingDatabase } from "@/db";
import { countWaitingJobs } from "@/db/job-queue-client";
import { pingAiService } from "@/features/extraction";
import { QUEUES } from "@/features/jobs";
import { runHealthChecks } from "@/features/observability";

export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 3_000;

// Public, unauthenticated: the report names checks and their state only – never hosts, users or
// error messages (ADR-0001 D10).
export async function GET(): Promise<Response> {
  let result;
  try {
    const { config, database, storage } = getRuntime();
    result = await runHealthChecks(
      { database: () => pingDatabase(database.pool), storage: () => storage.ping() },
      {
        timeoutMs: CHECK_TIMEOUT_MS,
        // Informational (#28): the AI service is an optional compose profile; the backlog shows work waiting.
        dependencies: { aiService: () => pingAiService(config.aiService.baseUrl) },
        backlog: {
          [QUEUES.processRequest]: () => countWaitingJobs(database.pool, QUEUES.processRequest),
          [QUEUES.exportRequest]: () => countWaitingJobs(database.pool, QUEUES.exportRequest),
        },
      },
    );
  } catch (error) {
    // Invalid configuration: the response stays generic; the log names the variables (never values,
    // see loadConfig) so operators can fix it.
    console.error(JSON.stringify({ level: "error", route: "/api/health", message: error instanceof Error ? error.message : "configuration error" }));
    result = { httpStatus: 503 as const, report: { status: "degraded" as const, checks: { config: "failed" as const } } };
  }
  return Response.json(result.report, { status: result.httpStatus, headers: { "cache-control": "no-store" } });
}
