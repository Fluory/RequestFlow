// Worker entrypoint (module `jobs`, ADR-0001 D2): drains processing jobs in a loop. pg-boss
// supervision (expiry → retry, retention) runs here. Start is fail-closed: missing configuration
// (e.g. AI_SERVICE_TOKEN) stops the process instead of silently skipping work.
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "@/config/env";
import { createDatabase } from "@/db";
import { createJobQueue } from "@/db/job-queue-client";
import { createAiServiceClient } from "@/features/extraction";
import { assertProcessingBudget, drain } from "@/features/jobs";
import { logEvent } from "@/features/observability";
import { S3BlobStore } from "@/features/storage";
import { createTenancy } from "@/features/tenancy";

const DRAIN_BUDGET_MS = 30_000;
const IDLE_MS = 2_000;

async function main(): Promise<void> {
  const config = loadConfig();
  assertProcessingBudget({ aiTimeoutMs: config.aiService.timeoutMs, maxFiles: config.upload.maxFiles });
  const ai = createAiServiceClient(config.aiService);
  const database = createDatabase(config.databaseUrl, { max: 4 });
  const storage = new S3BlobStore(config.storage);
  const boss = await createJobQueue(config.databaseUrl, { supervise: true });
  const deps = { tenancy: createTenancy(database.db), storage, ai, boss };

  let running = true;
  const stop = (signal: string) => {
    running = false;
    logEvent("info", "worker.stopping", {}, { code: signal });
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  logEvent("info", "worker.started");
  while (running) {
    try {
      const result = await drain(deps, { maxMs: DRAIN_BUDGET_MS });
      if (result.processed + result.failed + result.deadLettered === 0) await sleep(IDLE_MS);
    } catch (error) {
      // Infrastructure hiccup (database/storage): log the class only, back off, keep running.
      logEvent("error", "worker.drain_failed", {}, { code: error instanceof Error ? error.name : "unknown" });
      await sleep(IDLE_MS * 5);
    }
  }
  await boss.stop({ graceful: true, timeout: 20_000 });
  storage.destroy();
  await database.pool.end();
  logEvent("info", "worker.stopped");
}

main().catch((error: unknown) => {
  // Configuration errors name variables only (loadConfig/createAiServiceClient).
  console.error(JSON.stringify({ level: "error", event: "worker.start_failed", message: error instanceof Error ? error.message : "unknown" }));
  process.exit(1);
});
