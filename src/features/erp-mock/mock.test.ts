import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { receiptSchema } from "@/features/export";
import { createErpMock, MemoryMockStore, parseFaults } from "./mock";

const TOKEN = "local-dev-only-erp-token-0123456789";
const URL_ = "http://erp.test/v1/quote-requests";

function body(requestId: string, company = "Musterbau Beispiel GmbH") {
  return { requestId, subject: "Anfrage Flansche", approvedAt: "2026-09-23T07:00:00.000Z", fields: { company, contactPerson: "Erika Beispiel", requestedDeliveryDate: "2026-10-15" } };
}
function post(payload: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal,
  });
}
const keyed = (requestId: string) => ({ "idempotency-key": requestId });

describe("ERP mock – idempotent receiver (ADR-0001 D9)", () => {
  it("creates a record once and answers a repeat with the same key with the SAME reference (200)", async () => {
    const mock = createErpMock({ token: TOKEN, store: new MemoryMockStore() });
    const id = randomUUID();

    const first = await mock.handle(post(body(id), keyed(id)));
    const second = await mock.handle(post(body(id), keyed(id)));

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const [a, b] = [receiptSchema.parse(await first.json()), receiptSchema.parse(await second.json())];
    expect(b.erpReference).toBe(a.erpReference);
    expect(a.requestId).toBe(id);
    expect(mock.created()).toBe(1);
  });

  it("refuses the same key with a different body (409) and stores nothing new", async () => {
    const mock = createErpMock({ token: TOKEN, store: new MemoryMockStore() });
    const id = randomUUID();
    await mock.handle(post(body(id), keyed(id)));

    const conflict = await mock.handle(post(body(id, "Andere GmbH"), keyed(id)));

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "idempotency_conflict" } });
    expect(mock.created()).toBe(1);
  });

  it("requires a valid Idempotency-Key that names the request, a valid body and the bearer token", async () => {
    const mock = createErpMock({ token: TOKEN, store: new MemoryMockStore() });
    const id = randomUUID();

    expect((await mock.handle(post(body(id)))).status).toBe(400);
    expect((await mock.handle(post(body(id), { "idempotency-key": "not-a-uuid" }))).status).toBe(400);
    expect((await mock.handle(post(body(id), keyed(randomUUID())))).status).toBe(400);
    expect((await mock.handle(post({ ...body(id), extra: 1 }, keyed(id)))).status).toBe(400);
    expect((await mock.handle(post(body(id), { ...keyed(id), authorization: "Bearer wrong-token-000000000000000" }))).status).toBe(401);
    expect(mock.created()).toBe(0);
  });

  it("injects faults in order: 503 before storing, `lost` stores and still answers 503, `timeout` hangs until the caller gives up", async () => {
    const mock = createErpMock({ token: TOKEN, store: new MemoryMockStore(), faults: ["503", "lost", "timeout"], hangMs: 5_000 });
    const id = randomUUID();

    expect((await mock.handle(post(body(id), keyed(id)))).status).toBe(503);
    expect(mock.created()).toBe(0);
    expect((await mock.handle(post(body(id), keyed(id)))).status).toBe(503);
    expect(mock.created()).toBe(1);
    const started = Date.now();
    await expect(mock.handle(post(body(id), keyed(id), AbortSignal.timeout(50)))).resolves.toHaveProperty("status", 503);
    expect(Date.now() - started).toBeLessThan(2_000);
    const replay = await mock.handle(post(body(id), keyed(id)));
    expect(replay.status).toBe(200);
    expect(mock.created()).toBe(1);
  });

  it("parses the fault list from configuration and rejects unknown entries", () => {
    expect(parseFaults("")).toEqual([]);
    expect(parseFaults("503, lost,timeout")).toEqual(["503", "lost", "timeout"]);
    expect(() => parseFaults("500")).toThrow(/ERP_MOCK_FAULTS/);
  });
});
