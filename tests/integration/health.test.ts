import { afterEach, describe, expect, it, vi } from "vitest";

// Real PostgreSQL + SeaweedFS (docker compose up -d postgres storage, or the CI services).
// Mocks are not used here: the point is the real network boundary.
async function callHealth() {
  vi.resetModules(); // the route caches its runtime; each test gets a fresh one for its env
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with database and storage ok against the real services", async () => {
    const { status, body } = await callHealth();

    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", checks: { database: "ok", storage: "ok" } });
  });

  it("returns 503 naming the storage check when the storage credentials are wrong", async () => {
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "wrong-secret");

    const { status, body } = await callHealth();

    expect(status).toBe(503);
    expect(body).toEqual({ status: "degraded", checks: { database: "ok", storage: "failed" } });
  });

  it("returns 503 naming the database check when the database is unreachable, without details", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://app_rw:nope@127.0.0.1:1/requestflow");

    const { status, body } = await callHealth();

    expect(status).toBe(503);
    expect(body.checks.database).toBe("failed");
    expect(JSON.stringify(body)).not.toMatch(/127\.0\.0\.1|app_rw|ECONNREFUSED/);
  });
});
