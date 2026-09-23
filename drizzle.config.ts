import { defineConfig } from "drizzle-kit";

// drizzle-kit runs as the owner role; the app itself connects as `app_rw` (ADR-0001 D7).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  schemaFilter: ["app"],
  migrations: { schema: "drizzle" },
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? "" },
});
