import { sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss, type SendOptions } from "pg-boss";
import type { Database } from "./client";

// Transactional enqueue helper (ADR-0001 D4). Opening pg-boss pools lives in ./job-queue-client.ts
// (composition roots only – dependency-cruiser rule `no-db-connection-in-features`).

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type JobSender = Pick<PgBoss, "send">;

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
