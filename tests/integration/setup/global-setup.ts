import { runMigrations } from "@/db/migrate";
import { installJobQueues } from "@/db/job-queue";
import { QUEUE_DEFINITIONS } from "@/features/jobs";
import { S3BlobStore } from "@/features/storage";
import { loadConfig } from "@/config/env";

// Integration tests run against real services. Migrations are applied as the owner role,
// exactly as the deploy step does it; the bucket is created idempotently.
export default async function setup(): Promise<void> {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required for integration tests");
  await runMigrations(migrationUrl);
  await installJobQueues(migrationUrl, QUEUE_DEFINITIONS);

  const store = new S3BlobStore(loadConfig().storage);
  try {
    await store.ensureBucket();
  } finally {
    store.destroy();
  }
}
