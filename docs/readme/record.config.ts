import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import smoke from "../../playwright.config";

// Recordings for the README (root README.md): the same stack as the E2E smoke flows – built app,
// real worker, AI stub at its HTTP boundary, local PostgreSQL + S3, synthetic demo accounts and samples –
// with the showcase switch on, so the guest entry and the demo banner look as they do on the showcase
// (the per-client guest brake is lifted: every run starts a guest from the same local address).
//   pnpm build && pnpm exec playwright test -c docs/readme/record.config.ts
const root = fileURLToPath(new URL("../..", import.meta.url));
const servers = Array.isArray(smoke.webServer) ? smoke.webServer : smoke.webServer ? [smoke.webServer] : [];
process.env.DEMO_MODE = "true";

export default defineConfig({
  ...smoke,
  webServer: servers.map((server) => ({ ...server, cwd: root, env: { ...server.env, DEMO_MODE: "true", GUEST_MAX_PER_CLIENT_PER_DAY: "1000" } })),
  globalSetup: `${root}tests/e2e/global-setup.ts`,
  testDir: ".",
  testMatch: "app.record.ts",
  timeout: 240_000,
  workers: 1,
});
