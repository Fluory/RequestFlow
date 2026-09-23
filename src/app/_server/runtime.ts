import { loadConfig, type AppConfig } from "@/config/env";
import { createDatabase, type DatabaseHandle } from "@/db";
import { createAuth, getActor, type Actor, type Auth } from "@/features/identity";
import { createJobClient } from "@/features/jobs";
import { S3BlobStore } from "@/features/storage";
import { createTenancy, type Tenancy } from "@/features/tenancy";

// Composition root of the web process: one pool, one storage client and one auth instance per
// process, created on first use (never at import time, so `next build` needs no environment).
export interface Runtime {
  config: AppConfig;
  database: DatabaseHandle;
  storage: S3BlobStore;
  auth: Auth;
  tenancy: Tenancy;
}

let runtime: Runtime | undefined;

export function getRuntime(): Runtime {
  if (!runtime) {
    const config = loadConfig();
    const database = createDatabase(config.databaseUrl);
    runtime = {
      config,
      database,
      storage: new S3BlobStore(config.storage),
      auth: createAuth(database.db, config.auth),
      tenancy: createTenancy(database.db),
    };
  }
  return runtime;
}

let jobClient: ReturnType<typeof createJobClient> | undefined;

/** pg-boss client of the web process (send only, no supervision). */
export function getJobClient(): ReturnType<typeof createJobClient> {
  jobClient ??= createJobClient(getRuntime().config.databaseUrl).catch((error: unknown) => {
    jobClient = undefined;
    throw error;
  });
  return jobClient;
}

/** The signed-in actor for the current request, or null. */
export async function currentActor(headers: Headers): Promise<Actor | null> {
  const { auth, database } = getRuntime();
  return getActor(auth, database.db, headers);
}
