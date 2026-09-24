import { drainNow } from "@/app/_server/drain";
import { handleDrainRequest } from "@/app/_server/drain-request";
import { getRuntime } from "@/app/_server/runtime";
import { logEvent } from "@/features/observability";

export const dynamic = "force-dynamic";
// Must equal SERVERLESS_DRAIN.maxDurationSeconds (config) and vercel.json – a segment-config literal.
export const maxDuration = 300;

// GET (Vercel Cron) and POST (manual/operator trigger) /api/jobs/drain – one bounded drain round of
// processing and export jobs for runtimes without a worker (#59). `Authorization: Bearer <CRON_SECRET>`;
// 404 while CRON_SECRET is unset. No request body is read.
async function handle(request: Request): Promise<Response> {
  const invokedAt = Date.now();
  let cronSecret: string | undefined;
  try {
    cronSecret = getRuntime().config.jobs.cronSecret;
  } catch (error) {
    // Invalid configuration: generic answer; the log names the variables (never values, see loadConfig).
    const names = error instanceof Error ? /configuration: (.+)$/.exec(error.message)?.[1]?.split(", ") : undefined;
    logEvent("error", "jobs.drain_config_invalid", {}, { code: "config", names });
    return Response.json({ error: { title: "Verarbeitung derzeit nicht möglich." } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return handleDrainRequest(request, { cronSecret, run: () => drainNow(invokedAt) });
}

export const GET = handle;
export const POST = handle;
