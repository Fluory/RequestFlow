import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
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

  it("returns 200 with database and storage ok against the real services; AI service and backlog are informational (#28)", async () => {
    vi.stubEnv("AI_SERVICE_URL", "http://127.0.0.1:1");
    const { status, body } = await callHealth();

    expect(status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      checks: { database: "ok", storage: "ok" },
      dependencies: { aiService: "failed" },
      backlog: { "request-process": expect.any(Number), "request-export": expect.any(Number) },
    });
  });

  it("reports the AI service as reachable when its /healthz answers", async () => {
    const server = createServer((request, response) => void response.writeHead(request.url === "/healthz" ? 200 : 404).end('{"status":"ok"}'));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      vi.stubEnv("AI_SERVICE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      const { body } = await callHealth();
      expect(body.dependencies).toEqual({ aiService: "ok" });
    } finally {
      server.close();
    }
  });

  it("counts waiting jobs per queue (IDs never leave the database)", async () => {
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    try {
      const before = (await callHealth()).body.backlog["request-export"] as number;
      await owner.query("insert into pgboss.job (name, data) values ('request-export', '{}'::jsonb)");
      const after = (await callHealth()).body.backlog["request-export"] as number;
      expect(after).toBe(before + 1);
    } finally {
      await owner.query("delete from pgboss.job where name = 'request-export' and data = '{}'::jsonb");
      await owner.end();
    }
  });

  it("returns 503 naming the storage check when the storage credentials are wrong", async () => {
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "wrong-secret");

    const { status, body } = await callHealth();

    expect(status).toBe(503);
    expect(body).toMatchObject({ status: "degraded", checks: { database: "ok", storage: "failed" } });
    expect(Object.keys(body.checks)).toEqual(["database", "storage"]);
  });

  it("returns 503 naming the database check when the database is unreachable, without details", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://app_rw:nope@127.0.0.1:1/requestflow");

    const { status, body } = await callHealth();

    expect(status).toBe(503);
    expect(body.checks.database).toBe("failed");
    expect(JSON.stringify(body)).not.toMatch(/127\.0\.0\.1|app_rw|ECONNREFUSED/);
  });
});
