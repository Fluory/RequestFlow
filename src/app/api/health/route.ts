import { getRuntime } from "@/app/_server/runtime";
import { pingDatabase } from "@/db";
import { countWaitingJobs } from "@/db/job-queue-client";
import { pingAiService } from "@/features/extraction";
import { QUEUES } from "@/features/jobs";
import { cachedFor, logEvent, runHealthChecks } from "@/features/observability";

export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 3_000;
// Informational parts are cached (public endpoint): at most one AI ping and two counts per 10 s.
const INFO_TTL_MS = 10_000;
let informational:
  | { aiService: () => Promise<void>; process: () => Promise<number>; exportQueue: () => Promise<number> }
  | undefined;

// Public, unauthenticated: the report names checks and their state only – never hosts, users or
// error messages (ADR-0001 D10).
export async function GET(): Promise<Response> {
  let result;
  try {
    const { config, database, storage } = getRuntime();
    informational ??= {
      aiService: cachedFor(INFO_TTL_MS, () => pingAiService(config.aiService.baseUrl)),
      process: cachedFor(INFO_TTL_MS, () => countWaitingJobs(database.pool, QUEUES.processRequest)),
      exportQueue: cachedFor(INFO_TTL_MS, () => countWaitingJobs(database.pool, QUEUES.exportRequest)),
    };
    const info = informational;
    result = await runHealthChecks(
      { database: () => pingDatabase(database.pool), storage: () => storage.ping() },
      {
        timeoutMs: CHECK_TIMEOUT_MS,
        // Informational (#28): the AI service is an optional compose profile; the backlog shows work waiting.
        dependencies: { aiService: info.aiService },
        backlog: { [QUEUES.processRequest]: info.process, [QUEUES.exportRequest]: info.exportQueue },
      },
    );
  } catch (error) {
    // Invalid configuration: the response stays generic; the log names the variables (never values,
    // see loadConfig) so operators can fix it.
    const names = error instanceof Error ? /configuration: (.+)$/.exec(error.message)?.[1]?.split(", ") : undefined;
    logEvent("error", "health.config_invalid", {}, { code: "config", names });
    result = { httpStatus: 503 as const, report: { status: "degraded" as const, checks: { config: "failed" as const } } };
  }
  return Response.json(result.report, { status: result.httpStatus, headers: { "cache-control": "no-store" } });
}
