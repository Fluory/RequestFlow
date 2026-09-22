import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// Two projects: unit tests run anywhere; integration tests need `docker compose up -d postgres storage`.
export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" } },
      { resolve: { alias }, test: { name: "integration", include: ["tests/integration/**/*.test.ts"], environment: "node", testTimeout: 20_000 } },
    ],
  },
});
