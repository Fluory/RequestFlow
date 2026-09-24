// Worker entrypoint (module `jobs`, ADR-0001 D2): drains processing and export jobs in a loop. pg-boss
// supervision (expiry → retry, retention) runs here. Start is fail-closed: missing configuration
// (e.g. AI_SERVICE_TOKEN, ERP_TOKEN) stops the process instead of silently skipping work.
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "@/config/env";
import { createDatabase } from "@/db";
import { createJobQueue } from "@/db/job-queue-client";
import { createErpClient, drainExports } from "@/features/export";
import { createAiServiceClient } from "@/features/extraction";
import { assertProcessingBudget, drain } from "@/features/jobs";
import { logEvent } from "@/features/observability";
import { currentFieldValues, currentLineItemValues } from "@/features/review";
import { S3BlobStore } from "@/features/storage";
import { createTenancy } from "@/features/tenancy";

const DRAIN_BUDGET_MS = 30_000;
const IDLE_MS = 2_000;

async function main(): Promise<void> {
  const config = loadConfig();
  assertProcessingBudget({ aiTimeoutMs: config.aiService.timeoutMs, maxFiles: config.upload.maxFiles });
  const ai = createAiServiceClient(config.aiService);
  const erp = createErpClient(config.erp);
  const database = createDatabase(config.databaseUrl, { max: 4 });
  const storage = new S3BlobStore(config.storage);
  const boss = await createJobQueue(config.databaseUrl, { supervise: true, onError: (error) => logEvent("error", "jobs.error", {}, { code: error.name }) });
  const tenancy = createTenancy(database.db);
  const deps = { tenancy, storage, ai, boss };
  // The export reads the reviewed values through the review module (injected – no module cycle).
  const exportDeps = { tenancy, erp, boss, fieldValues: currentFieldValues, lineItemValues: currentLineItemValues };

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
      const processing = await drain(deps, { maxMs: DRAIN_BUDGET_MS });
      const exports = await drainExports(exportDeps, { maxMs: DRAIN_BUDGET_MS });
      const handled = processing.processed + processing.failed + processing.deadLettered + exports.exported + exports.failed + exports.deadLettered;
      if (handled === 0) await sleep(IDLE_MS);
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
  // Configuration errors name the variables (never values) – see loadConfig.
  const names = error instanceof Error ? /configuration: (.+)$/.exec(error.message)?.[1]?.split(", ") : undefined;
  logEvent("error", "worker.start_failed", {}, { code: error instanceof Error ? error.name : "unknown", names });
  process.exit(1);
});
