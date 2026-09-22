// Deploy step (`pnpm setup:deploy`, compose service `setup`): apply migrations as the owner role and
// make sure the private bucket exists. Explicit, never a side effect of the web or worker start
// (.claude/rules/database-migrations.md).
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "@/config/env";
import { runMigrations } from "@/db/migrate";
import { S3BlobStore } from "@/features/storage";

const ATTEMPTS = 30;
const DELAY_MS = 2_000;

const log = (level: "info" | "error", message: string) =>
  console[level === "error" ? "error" : "log"](JSON.stringify({ level, process: "setup", message }));

// Messages only: connection strings never reach the log.
const describe = (error: unknown) =>
  error instanceof Error ? error.message.replace(/\w+:\/\/\S+/g, "<url>") : "unknown error";

// Database and storage may still be starting (compose starts them in parallel); retry, bounded.
async function withRetry(step: string, action: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await action();
      return;
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
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
  const store = new S3BlobStore(config.storage);
  try {
    await withRetry("bucket", () => store.ensureBucket());
  } finally {
    store.destroy();
  }
  log("info", "migrations applied, bucket ready");
}

main().catch((error: unknown) => {
  log("error", describe(error));
  process.exit(1);
});
