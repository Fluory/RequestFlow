import { loadConfig, type AppConfig } from "@/config/env";
import { createDatabase, type DatabaseHandle } from "@/db";
import { S3BlobStore } from "@/features/storage";

// Composition root of the web process: one pool and one storage client per process, created on
// first use (never at import time, so `next build` needs no environment).
export interface Runtime {
  config: AppConfig;
  database: DatabaseHandle;
  storage: S3BlobStore;
}

let runtime: Runtime | undefined;

export function getRuntime(): Runtime {
  if (!runtime) {
    const config = loadConfig();
    runtime = { config, database: createDatabase(config.databaseUrl), storage: new S3BlobStore(config.storage) };
  }
  return runtime;
}
