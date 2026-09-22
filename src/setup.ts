// Deploy step (`pnpm setup:deploy`, compose service `setup`): apply migrations as the owner role and
// make sure the private bucket exists. Explicit, never a side effect of the web or worker start
// (.claude/rules/database-migrations.md).
import { loadConfig } from "@/config/env";
import { runMigrations } from "@/db/migrate";
import { S3BlobStore } from "@/features/storage";

async function main(): Promise<void> {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) throw new Error("Invalid or missing configuration: MIGRATION_DATABASE_URL");
  const config = loadConfig();

  await runMigrations(migrationUrl);
  const store = new S3BlobStore(config.storage);
  try {
    await store.ensureBucket();
  } finally {
    store.destroy();
  }
  console.log(JSON.stringify({ level: "info", process: "setup", message: "migrations applied, bucket ready" }));
}

main().catch((error: unknown) => {
  // Message only: connection strings never reach the log.
  const message = error instanceof Error ? error.message.replace(/\w+:\/\/\S+/g, "<url>") : "unknown error";
  console.error(JSON.stringify({ level: "error", process: "setup", message }));
  process.exit(1);
});
