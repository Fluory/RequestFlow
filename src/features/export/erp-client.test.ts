import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createErpMock, MemoryMockStore, type MockFault } from "@/features/erp-mock";
import type { QuoteRequest } from "./contract";
import { createErpClient, ErpExportError } from "./erp-client";

const TOKEN = "local-dev-only-erp-token-0123456789";

/** Routes the adapter's HTTP calls into the mock in-process – the network boundary is the only fake. */
function viaMock(faults: MockFault[] = []) {
  const mock = createErpMock({ token: TOKEN, store: new MemoryMockStore(), faults, hangMs: 5_000 });
  const calls: Array<{ url: string; key: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({ url: request.url, key: request.headers.get("idempotency-key") });
    const response = await mock.handle(request);
    // Like real fetch: an aborted call rejects with the signal's reason (TimeoutError), whatever came back.
    if (request.signal.aborted) throw request.signal.reason;
    return response;
  };
  return { mock, calls, client: createErpClient({ baseUrl: "http://web:3000/api/erp-mock", token: TOKEN, timeoutMs: 100, fetch: fetchImpl }) };
}
const payload = (requestId = randomUUID()): QuoteRequest => ({
  requestId,
  subject: "Anfrage",
  approvedAt: "2026-09-23T07:00:00.000Z",
  fields: { company: "Musterbau Beispiel GmbH", contactPerson: null, requestedDeliveryDate: "2026-10-15" },
});
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as ErpExportError);

describe("ERP REST adapter", () => {
  it("posts to <base>/v1/quote-requests with the requestId as Idempotency-Key and returns the receipt", async () => {
    const { client, calls } = viaMock();
    const body = payload();

    const result = await client.submit(body);

    expect(calls).toEqual([{ url: "http://web:3000/api/erp-mock/v1/quote-requests", key: body.requestId }]);
    expect(result).toMatchObject({ replay: false, receipt: { requestId: body.requestId } });
    expect((await client.submit(body)).replay).toBe(true);
  });

  it("classifies 503 and a timeout as retryable", async () => {
    const { client } = viaMock(["503", "timeout"]);
    const body = payload();

    expect(await failureOf(client.submit(body))).toMatchObject({ code: "http", status: 503, retryable: true });
    expect(await failureOf(client.submit(body))).toMatchObject({ code: "timeout", retryable: true });
  });

  it("classifies an unreachable ERP as retryable and a conflict or bad token as permanent", async () => {
    const unreachable = createErpClient({ baseUrl: "http://x", token: TOKEN, timeoutMs: 100, fetch: () => Promise.reject(new TypeError("fetch failed")) });
    expect(await failureOf(unreachable.submit(payload()))).toMatchObject({ code: "unreachable", retryable: true });

    const { client } = viaMock();
    const body = payload();
    await client.submit(body);
    expect(await failureOf(client.submit({ ...body, subject: "geändert" }))).toMatchObject({ code: "http", status: 409, retryable: false });

    const wrongToken = createErpClient({ baseUrl: "http://x", token: "wrong-token-000000000000000000", timeoutMs: 100, fetch: (input, init) => viaMock().mock.handle(new Request(input, init)) });
    expect(await failureOf(wrongToken.submit(payload()))).toMatchObject({ status: 401, retryable: false });
  });

  it("treats a 2xx answer that breaks the contract or names another request as a permanent contract violation", async () => {
    const answer = (body: unknown) => createErpClient({ baseUrl: "http://x", token: TOKEN, timeoutMs: 100, fetch: async () => Response.json(body, { status: 201 }) });
    const body = payload();

    expect(await failureOf(answer({ erpReference: "" }).submit(body))).toMatchObject({ code: "contract_violation", retryable: false });
    expect(await failureOf(answer({ erpReference: "QR-1", requestId: randomUUID(), receivedAt: "2026-09-23T07:00:00.000Z" }).submit(body))).toMatchObject({
      code: "contract_violation",
    });
  });

  it("treats a body that cannot be read (reset or timeout mid-body) as retryable – the outcome is unknown", async () => {
    const broken = new ReadableStream({ start: (controller) => controller.error(new TypeError("terminated")) });
    const client = createErpClient({ baseUrl: "http://x", token: TOKEN, timeoutMs: 100, fetch: async () => new Response(broken, { status: 201 }) });

    expect(await failureOf(client.submit(payload()))).toMatchObject({ code: "unreachable", retryable: true });
  });

  it("refuses to start without a token (fail closed)", () => {
    expect(() => createErpClient({ baseUrl: "http://x", token: undefined, timeoutMs: 100 })).toThrow(/ERP_TOKEN/);
  });
});
