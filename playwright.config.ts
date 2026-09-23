import { defineConfig } from "@playwright/test";

// Smoke flow for `pnpm verify:full` (frontend-e2e rule: only the defined smoke flows). Runs the built
// app (`pnpm build` first), the real worker and a stub of the AI service at its HTTP boundary against
// the local PostgreSQL + S3 stack. Defaults are the synthetic local values from `.env.example`.
const port = 3200;
const defaults: Record<string, string> = {
  DATABASE_URL: "postgres://app_rw:rw-local-dev@127.0.0.1:54329/requestflow",
  MIGRATION_DATABASE_URL: "postgres://app_owner:owner-local-dev@127.0.0.1:54329/requestflow",
  S3_ENDPOINT: "http://127.0.0.1:8333",
  S3_REGION: "eu-central-1",
  S3_BUCKET: "requestflow-documents",
  S3_ACCESS_KEY_ID: "local-access-key",
  S3_SECRET_ACCESS_KEY: "local-secret-key",
  S3_FORCE_PATH_STYLE: "true",
  BETTER_AUTH_SECRET: "local-dev-only-secret-change-me-0123456789",
  BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
  APP_ENV: "local",
  AI_SERVICE_URL: "http://127.0.0.1:8799",
  AI_SERVICE_TOKEN: "local-dev-only-ai-token-0123456789",
  AI_STUB_PORT: "8799",
  ERP_BASE_URL: `http://127.0.0.1:${port}/api/erp-mock`,
  ERP_TOKEN: "local-dev-only-erp-token-0123456789",
  ERP_MOCK_ENABLED: "true",
  SEED_PASSWORD: "demo-password-local-only",
};
const env: Record<string, string> = Object.fromEntries(Object.entries(defaults).map(([name, value]) => [name, process.env[name] ?? value]));
Object.assign(process.env, env);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    // The cloud session ships a pinned Chromium; CI installs Playwright's own (`playwright install`).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    { command: "node tests/e2e/ai-stub.mjs", url: "http://127.0.0.1:8799/healthz", env, reuseExistingServer: false },
    { command: `pnpm exec next start -p ${port} -H 127.0.0.1`, url: `http://127.0.0.1:${port}/api/health`, env, timeout: 60_000, reuseExistingServer: false },
    { command: "pnpm -s worker", env, wait: { stdout: /worker\.started/ }, reuseExistingServer: false },
  ],
});
