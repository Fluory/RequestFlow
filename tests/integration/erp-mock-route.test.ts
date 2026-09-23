import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

// The mock route as deployed with ERP_MOCK_ENABLED=true (set before the runtime reads its config;
// each test file gets its own module registry, so other files keep the default "off").
process.env.ERP_MOCK_ENABLED = "true";
process.env.ERP_TOKEN = "local-dev-only-erp-token-0123456789";
const { POST } = await import("@/app/api/erp-mock/v1/quote-requests/route");
const { getRuntime } = await import("@/app/_server/runtime");
const { errorSchema, receiptSchema } = await import("@/features/export");

const call = (body: string, headers: Record<string, string>) =>
  POST(new Request("http://localhost:3000/api/erp-mock/v1/quote-requests", { method: "POST", body, headers: { "content-length": String(Buffer.byteLength(body)), ...headers } }));
const auth = { authorization: `Bearer ${process.env.ERP_TOKEN}`, "content-type": "application/json" };

describe("ERP mock route (flag on)", () => {
  afterAll(async () => {
    await getRuntime().database.pool.end();
  });

  it("answers per contract: 201 once, 200 with the same reference for the replay", async () => {
    const requestId = randomUUID();
    const body = JSON.stringify({ requestId, subject: null, approvedAt: "2026-09-23T07:00:00.000Z", fields: { company: "Musterbau Beispiel GmbH", contactPerson: null, requestedDeliveryDate: null } });

    const first = await call(body, { ...auth, "idempotency-key": requestId });
    const second = await call(body, { ...auth, "idempotency-key": requestId });

    expect([first.status, second.status]).toEqual([201, 200]);
    expect(receiptSchema.parse(await second.json()).erpReference).toBe(receiptSchema.parse(await first.json()).erpReference);
  });

  it("bounds the body before reading it and refuses a wrong token, with the contract's error shape", async () => {
    const tooLarge = await POST(new Request("http://localhost:3000/api/erp-mock/v1/quote-requests", { method: "POST", body: "{}", headers: { ...auth, "content-length": String(65 * 1024) } }));
    const noLength = await POST(new Request("http://localhost:3000/api/erp-mock/v1/quote-requests", { method: "POST", body: "{}", headers: auth }));
    const wrongToken = await call("{}", { authorization: "Bearer nope", "idempotency-key": randomUUID() });

    expect(tooLarge.status).toBe(413);
    expect(noLength.status).toBe(411);
    expect(wrongToken.status).toBe(401);
    for (const response of [tooLarge, noLength, wrongToken]) expect(errorSchema.safeParse(await response.json()).success).toBe(true);
  });
});
