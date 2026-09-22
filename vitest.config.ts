import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// Integration tests talk to the local stack (`docker compose up -d postgres storage`). These are the
// compose LOCAL DEFAULTS from `.env.example` – synthetic, machine-local, never used by a real
// environment. Values already set in the environment (CI, .env) win.
const localStackDefaults: Record<string, string> = {
  DATABASE_URL: "postgres://app_rw:rw-local-dev@127.0.0.1:54329/requestflow",
  MIGRATION_DATABASE_URL: "postgres://app_owner:owner-local-dev@127.0.0.1:54329/requestflow",
  S3_ENDPOINT: "http://127.0.0.1:8333",
  S3_REGION: "eu-central-1",
  S3_BUCKET: "requestflow-documents",
  S3_ACCESS_KEY_ID: "local-access-key",
  S3_SECRET_ACCESS_KEY: "local-secret-key",
  S3_FORCE_PATH_STYLE: "true",
};
const integrationEnv = Object.fromEntries(
  Object.entries(localStackDefaults).map(([name, value]) => [name, process.env[name] ?? value]),
);
if (process.argv.includes("integration")) Object.assign(process.env, integrationEnv);

// Two projects: unit tests run anywhere; integration tests need real PostgreSQL + S3 storage.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["src/**/*.test.ts", "tests/architecture/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          env: integrationEnv,
          globalSetup: ["tests/integration/setup/global-setup.ts"],
          testTimeout: 20_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
