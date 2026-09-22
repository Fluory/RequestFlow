import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

// The raw client lives here and in `tenancy` only (ADR-0001 D7). Feature code receives a
// tenant-scoped transaction from `withTenant()` – never this pool.
export type Database = NodePgDatabase;

export interface DatabaseHandle {
  pool: pg.Pool;
  db: Database;
}

export function createDatabase(connectionString: string, options: { max?: number } = {}): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });
  return { pool, db: drizzle(pool) };
}

export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("select 1");
}
