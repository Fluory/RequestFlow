import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss, type Queue, type SendOptions } from "pg-boss";
import type { Database } from "./client";

// pg-boss (ADR-0001 D4) opens its own pool, so it lives here with the other database clients
// (AGENTS.md: no raw DB client outside src/db and tenancy). Feature modules get the instance
// injected and only send/fetch/complete.
export const PGBOSS_SCHEMA = "pgboss";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type JobSender = Pick<PgBoss, "send">;

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
  });
  boss.on("error", (error: Error) => console.error(JSON.stringify({ level: "error", module: "jobs", message: error.message })));
  await boss.start();
  return boss;
}

/**
 * Enqueues IN the caller's transaction (transactional outbox without an outbox table): the job
 * exists exactly when the transaction commits. A job refused by the queue policy is an error.
 */
export async function sendInTransaction(
  queue: JobSender,
  tx: Transaction,
  name: string,
  data: object,
  options: Omit<SendOptions, "db"> = {},
): Promise<string> {
  const id = await queue.send(name, data, { ...options, db: fromDrizzle(tx, sql) });
  if (!id) throw new Error(`job refused by queue policy: ${name}`);
  return id;
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
      `GRANT SELECT ON ${s}.version, ${s}.schedule, ${s}.subscription TO app_rw`,
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
