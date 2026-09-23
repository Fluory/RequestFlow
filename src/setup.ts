// Deploy step (`pnpm setup:deploy`, compose service `setup`): apply migrations as the owner role and
// make sure the private bucket exists. Explicit, never a side effect of the web or worker start
// (.claude/rules/database-migrations.md).
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "@/config/env";
import { runMigrations } from "@/db/migrate";
import { installJobQueues } from "@/db/job-queue-client";
import { QUEUE_DEFINITIONS } from "@/features/jobs";
import { S3BlobStore } from "@/features/storage";

const ATTEMPTS = 30;
const DELAY_MS = 2_000;

const log = (level: "info" | "error", message: string) =>
  console[level === "error" ? "error" : "log"](JSON.stringify({ level, process: "setup", message }));

// Messages only: connection strings never reach the log.
const describe = (error: unknown) =>
  error instanceof Error ? error.message.replace(/\w+:\/\/\S+/g, "<url>") : "unknown error";

// Only "not reachable yet" is worth waiting for; a misconfiguration (role guard, wrong credentials)
// fails at once so its real cause is the last log line.
const TRANSIENT = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|timeout|starting up|not yet accepting|socket hang up/i;
const isTransient = (error: unknown) =>
  error instanceof Error && (TRANSIENT.test(error.message) || TRANSIENT.test(String((error as { code?: unknown }).code ?? "")));

// Database and storage may still be starting (compose starts them in parallel); retry, bounded.
async function withRetry(step: string, action: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await action();
      return;
    } catch (error) {
      if (attempt >= ATTEMPTS || !isTransient(error)) throw error;
      log("info", `${step} not ready (attempt ${attempt}/${ATTEMPTS}): ${describe(error)}`);
      await sleep(DELAY_MS);
    }
  }
}

async function main(): Promise<void> {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) throw new Error("Invalid or missing configuration: MIGRATION_DATABASE_URL");
  const config = loadConfig();

  await withRetry("migrations", () => runMigrations(migrationUrl));
  await withRetry("job queues", () => installJobQueues(migrationUrl, QUEUE_DEFINITIONS));
  const store = new S3BlobStore(config.storage);
  try {
    await withRetry("bucket", () => store.ensureBucket());
  } finally {
    store.destroy();
  }
  log("info", "migrations applied, job queues installed, bucket ready");
}

main().catch((error: unknown) => {
  log("error", describe(error));
  process.exit(1);
});
