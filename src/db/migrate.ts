import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

// Runs as the owner role (MIGRATION_DATABASE_URL). A migration is an explicit deploy step,
// never a side effect of the app start (.claude/rules/database-migrations.md).
export async function runMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema: "drizzle" });
  } finally {
    await client.end();
  }
}
