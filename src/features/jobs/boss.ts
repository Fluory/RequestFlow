import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";
import { tenantOf, type TenantTx } from "@/features/tenancy";
import { PGBOSS_SCHEMA, QUEUE_DEFINITIONS, QUEUES, type RequestJob } from "./queues";

/**
 * pg-boss client for the runtime role (`app_rw`): no schema creation, no migration, no supervision –
 * those belong to the deploy step (`installJobQueues`) and the worker. Polling, no LISTEN/NOTIFY
 * (ADR-0001 D3/D4).
 */
export async function createJobClient(connectionString: string, options: { supervise?: boolean } = {}): Promise<PgBoss> {
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
 * Enqueues processing of a request IN the caller's tenant transaction (transactional outbox without
 * an outbox table): the job exists exactly when the transaction commits.
 */
export async function enqueueRequestProcessing(boss: Pick<PgBoss, "send">, tx: TenantTx, requestId: string): Promise<string | null> {
  const job: RequestJob = { requestId, companyId: tenantOf(tx) };
  return boss.send(QUEUES.processRequest, job, { db: fromDrizzle(tx, sql), singletonKey: requestId });
}

/** Deploy step, owner role: install/upgrade the pg-boss schema and queues, grant the runtime role. */
export async function installJobQueues(ownerConnectionString: string): Promise<void> {
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
    for (const { name, policy, ...options } of QUEUE_DEFINITIONS) {
      // The policy is fixed at creation; retries, expiry and dead letter can be updated in place.
      if (await boss.getQueue(name)) await boss.updateQueue(name, options);
      else await boss.createQueue(name, { policy, ...options });
    }
    const db = boss.getDb();
    for (const statement of [
      `GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO app_rw`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO app_rw`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO app_rw`,
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${PGBOSS_SCHEMA} TO app_rw`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${PGBOSS_SCHEMA} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw`,
    ]) {
      await db.executeSql(statement);
    }
  } finally {
    await boss.stop({ graceful: false });
  }
}
