import { PgBoss, type Queue } from "pg-boss";

// pg-boss opens its own pool, so its construction lives in src/db with the other database clients
// (AGENTS.md: no raw DB client outside src/db and tenancy) and is called only by composition roots
// (web runtime, worker, deploy step, tests). Feature modules get the instance injected.
export const PGBOSS_SCHEMA = "pgboss";

/** Runtime client (`app_rw`): no schema creation or migration; polling, no LISTEN/NOTIFY. */
export async function createJobQueue(connectionString: string, options: { supervise?: boolean } = {}): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    max: 4,
    migrate: false,
    createSchema: false,
    supervise: options.supervise ?? false,
    schedule: false,
    // Persisted queue statistics create daily partitions (DDL) – the runtime role has no DDL rights.
    persistQueueStats: false,
  });
  boss.on("error", (error: Error) => console.error(JSON.stringify({ level: "error", module: "jobs", message: error.message })));
  await boss.start();
  return boss;
}

/**
 * Deploy step, owner role: install/upgrade the pg-boss schema and queues, then grant the runtime role
 * the least it needs – job rows read/write, queue and version read, queue statistics maintenance.
 */
export async function installJobQueues(ownerConnectionString: string, definitions: Queue[]): Promise<void> {
  const boss = new PgBoss({
    connectionString: ownerConnectionString,
    schema: PGBOSS_SCHEMA,
    max: 2,
    migrate: true,
    supervise: false,
    schedule: false,
  });
  boss.on("error", () => {});
  await boss.start();
  try {
    for (const { name, policy, ...options } of definitions) {
      // The policy is fixed at creation; retries, expiry and dead letter can be updated in place.
      if (await boss.getQueue(name)) await boss.updateQueue(name, options);
      else await boss.createQueue(name, { policy, ...options });
    }
    const db = boss.getDb();
    const s = PGBOSS_SCHEMA;
    for (const statement of [
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM app_rw`,
      `GRANT USAGE ON SCHEMA ${s} TO app_rw`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${s}.job, ${s}.job_common, ${s}.job_dependency, ${s}.warning, ${s}.bam TO app_rw`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${s}.queue_stats TO app_rw`,
      `GRANT SELECT, UPDATE ON ${s}.queue TO app_rw`,
      `GRANT SELECT, UPDATE ON ${s}.version TO app_rw`, // supervise() records its maintenance timestamps here
      `GRANT SELECT ON ${s}.schedule, ${s}.subscription TO app_rw`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO app_rw`,
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${s} TO app_rw`,
      // Partitions of job/queue_stats created later by the owner inherit the table privileges.
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw`,
    ]) {
      await db.executeSql(statement);
    }
  } finally {
    await boss.stop({ graceful: false });
  }
}
