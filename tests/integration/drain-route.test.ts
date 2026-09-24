import { after } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as drainGet, POST as drainPost } from "@/app/api/jobs/drain/route";
import { POST as upload } from "@/app/api/requests/route";
import { getJobClient, getRuntime } from "@/app/_server/runtime";
import { SERVERLESS_DRAIN } from "@/config/env";
import { drainRound } from "@/job-drain";
import { companyWithAdmin, createStack, type Stack } from "./helpers/stack";

// Wiring of the serverless triggers (#59) in the web process's own runtime (same env as `next start`):
// the route's secret gate with the real configuration, and the upload's `after()` hook with
// JOB_DRAIN_INLINE=true. The drain round itself is replaced here – the shared queues of other runs must
// stay untouched; tests/integration/drain.test.ts drains real jobs with the real round.
const SECRET = "cron-secret-synthetic-0123456789";
Object.assign(process.env, {
  CRON_SECRET: SECRET,
  JOB_DRAIN_INLINE: "true",
  // A worst-case processing job must fit into one function run, or loadConfig refuses the drain.
  AI_SERVICE_TIMEOUT_MS: "60000",
  UPLOAD_MAX_FILES: "3",
  AI_SERVICE_TOKEN: "t".repeat(24),
  ERP_TOKEN: "local-dev-only-erp-token-0123456789",
});

const summary = { processing: { processed: 0, failed: 0, deadLettered: 0 }, exports: { exported: 0, failed: 0, deadLettered: 0 } };
vi.mock("@/job-drain", async (original) => ({ ...(await original<typeof import("@/job-drain")>()), drainRound: vi.fn(async () => summary) }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));

describe("drain route and inline drain wiring", () => {
  let stack: Stack;
  let cookie: string;
  const request = (authorization?: string) => new Request("http://localhost:3000/api/jobs/drain", { headers: authorization ? { authorization } : {} });

  beforeAll(async () => {
    stack = createStack();
    cookie = (await companyWithAdmin(stack)).cookie;
  });
  beforeEach(() => {
    vi.mocked(drainRound).mockClear();
    vi.mocked(after).mockClear();
  });
  afterAll(async () => {
    await (await getJobClient()).stop({ graceful: false });
    await getRuntime().database.pool.end();
    await stack.close();
  });

  it("refuses requests without or with a wrong secret (401) and drains nothing", async () => {
    expect((await drainGet(request())).status).toBe(401);
    expect((await drainGet(request("Bearer cron-secret-synthetic-WRONG-000000"))).status).toBe(401);
    expect((await drainPost(request(`Basic ${SECRET}`))).status).toBe(401);
    expect(drainRound).not.toHaveBeenCalled();
  });

  it("with the configured secret runs one round with maintenance and the serverless budgets", async () => {
    const response = await drainGet(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(drainRound).toHaveBeenCalledTimes(1);
    // The processing window is the serverless budget minus the time this invocation already spent.
    const options = vi.mocked(drainRound).mock.calls[0]![1];
    expect(options).toMatchObject({ exportMs: SERVERLESS_DRAIN.exportMs, maintenance: true });
    expect(options.processMs).toBeLessThanOrEqual(SERVERLESS_DRAIN.processMs);
    expect(options.processMs).toBeGreaterThan(SERVERLESS_DRAIN.processMs - 5_000);
  });

  it("an accepted upload schedules one drain after the response (JOB_DRAIN_INLINE=true)", async () => {
    const form = new FormData();
    form.append("files", new File(["%PDF-1.7\n% synthetic inline drain\n"], "anfrage.pdf", { type: "application/pdf" }));
    const encoded = new Response(form);
    const body = new Uint8Array(await encoded.arrayBuffer());
    const headers = { "content-type": encoded.headers.get("content-type")!, "content-length": String(body.byteLength), cookie };

    const created = await upload(new Request("http://localhost:3000/api/requests", { method: "POST", body, headers }));
    const refused = await upload(new Request("http://localhost:3000/api/requests", { method: "POST", body, headers: { ...headers, cookie: "" } }));

    expect(created.status).toBe(201);
    expect(refused.status).toBe(401);
    expect(after).toHaveBeenCalledTimes(1);
    expect(drainRound).not.toHaveBeenCalled(); // only once the response is sent
    await (vi.mocked(after).mock.calls[0]![0] as () => Promise<void>)();
    expect(drainRound).toHaveBeenCalledTimes(1);
  });
});
