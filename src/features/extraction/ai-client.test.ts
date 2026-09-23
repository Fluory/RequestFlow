import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiServiceError, createAiServiceClient } from "./ai-client";
import { syntheticExtractResponse } from "./fixtures";

// The AI service is stubbed at its HTTP boundary only (testing rule: mocks at I/O boundaries).
type Handler = (request: IncomingMessage, response: ServerResponse, body: Buffer) => void;
let handler: Handler = (_request, response) => response.end();
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => handler(request, response, Buffer.concat(chunks)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};
const input = { bytes: new TextEncoder().encode("%PDF-1.7 synthetic"), filename: "a.pdf", mediaType: "application/pdf", documentId: "doc-1", correlationId: "req-1" };

describe("AI service client", () => {
  it("posts the document as multipart with bearer token and correlation id, and returns the parsed response", async () => {
    let seen: { auth?: string; requestId?: string; body: string } = { body: "" };
    handler = (request, response, body) => {
      seen = { auth: request.headers.authorization, requestId: request.headers["x-request-id"] as string, body: body.toString("latin1") };
      json(response, 200, syntheticExtractResponse("doc-1"));
    };
    const client = createAiServiceClient({ baseUrl, token: "t".repeat(24), timeoutMs: 2000 });

    const result = await client.extract(input);

    expect(result.fields.company.status).toBe("found");
    expect(seen.auth).toBe(`Bearer ${"t".repeat(24)}`);
    expect(seen.requestId).toBe("req-1");
    expect(seen.body).toContain('name="documentId"');
    expect(seen.body).toContain("%PDF-1.7 synthetic");
  });

  it.each([429, 500, 502, 503])("classifies HTTP %i as retryable", async (status) => {
    handler = (_request, response) => json(response, status, { error: { code: "x", message: "m" }, requestId: null });
    const client = createAiServiceClient({ baseUrl, token: "t".repeat(24), timeoutMs: 2000 });

    await expect(client.extract(input)).rejects.toMatchObject({ retryable: true, status });
  });

  it.each([
    [413, "document"],
    [415, "document"],
    [422, "document"],
    [400, "service"],
    [401, "service"],
    [404, "service"],
    [405, "service"],
  ] as const)("classifies HTTP %i as permanent (scope %s)", async (status, scope) => {
    handler = (_request, response) => json(response, status, { error: { code: "x", message: "m" }, requestId: null });
    const client = createAiServiceClient({ baseUrl, token: "t".repeat(24), timeoutMs: 2000 });

    await expect(client.extract(input)).rejects.toMatchObject({ retryable: false, status, scope });
  });

  it("times out and classifies the timeout as retryable", async () => {
    handler = () => {}; // never answers
    const client = createAiServiceClient({ baseUrl, token: "t".repeat(24), timeoutMs: 100 });

    await expect(client.extract(input)).rejects.toMatchObject({ retryable: true, code: "timeout" });
  });

  it("treats an unreachable service as retryable", async () => {
    const client = createAiServiceClient({ baseUrl: "http://127.0.0.1:1", token: "t".repeat(24), timeoutMs: 500 });

    await expect(client.extract(input)).rejects.toBeInstanceOf(AiServiceError);
    await expect(client.extract(input)).rejects.toMatchObject({ retryable: true, code: "unreachable" });
  });

  it("rejects a response that does not match the contract (permanent, service scope)", async () => {
    handler = (_request, response) => json(response, 200, { hello: "world" });
    const client = createAiServiceClient({ baseUrl, token: "t".repeat(24), timeoutMs: 2000 });

    await expect(client.extract(input)).rejects.toMatchObject({ retryable: false, code: "contract_violation" });
  });

  it.each([
    ["found without evidence", (r: ReturnType<typeof syntheticExtractResponse>) => ({ ...r, fields: { ...r.fields, company: { ...r.fields.company, evidence: null } } })],
    ["evidence citing an unknown segment", (r: ReturnType<typeof syntheticExtractResponse>) => ({ ...r, fields: { ...r.fields, company: { ...r.fields.company, evidence: { segmentId: "s99", quote: "x" } } } })],
    ["duplicate segment ids", (r: ReturnType<typeof syntheticExtractResponse>) => ({ ...r, segments: [...r.segments, r.segments[0]!] })],
    ["a different documentId", (r: ReturnType<typeof syntheticExtractResponse>) => ({ ...r, documentId: "other" })],
  ])("rejects a response with %s as a contract violation (never retried)", async (_name, mutate) => {
    handler = (_request, response) => json(response, 200, mutate(syntheticExtractResponse("doc-1")));
    const client = createAiServiceClient({ baseUrl, token: "t".repeat(24), timeoutMs: 2000 });

    await expect(client.extract(input)).rejects.toMatchObject({ retryable: false, code: "contract_violation" });
  });

  it("refuses to run without a token (fail closed)", () => {
    expect(() => createAiServiceClient({ baseUrl, token: undefined, timeoutMs: 1000 })).toThrow(/AI_SERVICE_TOKEN/);
  });
});
