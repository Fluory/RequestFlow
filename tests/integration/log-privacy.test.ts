import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/config/env";
import { createJobQueue } from "@/db/job-queue-client";
import { createErpMock, MemoryMockStore } from "@/features/erp-mock";
import { createErpClient, drainExports } from "@/features/export";
import { createAiServiceClient } from "@/features/extraction";
import { syntheticExtractResponse } from "@/features/extraction/fixtures";
import { getActor, type Actor } from "@/features/identity";
import { submitUpload } from "@/features/intake";
import { drain } from "@/features/jobs";
import { captureLogs } from "@/features/observability";
import { getRequest } from "@/features/requests";
import { approveRequest, correctField, currentFieldValues } from "@/features/review";
import { S3BlobStore } from "@/features/storage";
import { createTenancy, type Tenancy } from "@/features/tenancy";
import { companyWithAdmin, createStack, invitedUser, type Stack } from "./helpers/stack";

// #28: a full synthetic run – upload, processing, correction, approval, export – writes IDs and codes
// to the logs, never document content or personal data. The AI service is a local HTTP stub and the
// ERP the mock module (external boundaries); database, storage and pg-boss are real.
describe("logs of a full synthetic run carry no content and no personal data", () => {
  let stack: Stack;
  let tenancy: Tenancy;
  let boss: PgBoss;
  let storage: S3BlobStore;
  let server: Server;
  let clerk: Actor;

  // Everything personal or document-like in this run – none of it may appear in a log line.
  const SECRETS = ["Musterbau", "Erika", "Beispiel", "einkauf@example.com", "example.com", "15.10.2026", "2026-10-15", "Flansche", "Korrigierte Firma"];

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const documentId = /name="documentId"\r\n\r\n([^\r]+)/.exec(Buffer.concat(chunks).toString("latin1"))?.[1] ?? "";
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(syntheticExtractResponse(documentId)));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const config = loadConfig();
    stack = createStack();
    tenancy = createTenancy(stack.database.db);
    storage = new S3BlobStore(config.storage);
    boss = await createJobQueue(config.databaseUrl);
    const a = await companyWithAdmin(stack);
    const admin = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: a.cookie })))!;
    clerk = (await getActor(stack.auth, stack.database.db, new Headers({ cookie: (await invitedUser(stack, admin, "clerk")).cookie })))!;
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    storage.destroy();
    server.close();
    await stack.close();
  });

  it("upload → processing → correction → approval → export", async () => {
    const ai = createAiServiceClient({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: "t".repeat(24), timeoutMs: 5_000 });
    const mock = createErpMock({ token: "e".repeat(24), store: new MemoryMockStore() });
    const erp = createErpClient({ baseUrl: "http://erp", token: "e".repeat(24), timeoutMs: 2_000, fetch: async (input, init) => mock.handle(new Request(input, init)) });
    const mail = new TextEncoder().encode(
      `From: Einkauf <einkauf@example.com>\r\nSubject: Anfrage Flansche\r\nMessage-ID: <${randomUUID()}@example.com>\r\n\r\nMusterbau Beispiel GmbH\r\nAnsprechpartnerin: Erika Beispiel\r\nLiefertermin: 15.10.2026\r\n`,
    );
    const statusOf = async (id: string) => (await tenancy.withTenant(clerk.companyId, (tx) => getRequest(tx, id)))?.status;
    const until = async (predicate: () => Promise<boolean>, step: () => Promise<unknown>) => {
      for (let round = 0; round < 50 && !(await predicate()); round++) await step();
      expect(await predicate()).toBe(true);
    };

    const lines: string[] = [];
    const restore = captureLogs(lines);
    let requestId: string;
    try {
      ({ requestId } = await submitUpload({ tenancy, storage, boss, limits: { maxFileBytes: 1024 * 1024, maxFiles: 5 } }, clerk, [{ name: "anfrage.eml", bytes: mail }]));
      await until(async () => (await statusOf(requestId)) === "REVIEW", () => drain({ tenancy, storage, ai, boss }, { maxMs: 1_000 }));
      await correctField(tenancy, clerk, requestId, "company", "Korrigierte Firma GmbH");
      await approveRequest({ tenancy, boss }, clerk, requestId);
      await until(async () => (await statusOf(requestId)) === "EXPORTED", () => drainExports({ tenancy, erp, boss, fieldValues: currentFieldValues }, { maxMs: 1_000 }));
    } finally {
      restore();
    }

    // The run was logged (correlated by the request id) …
    const ours = lines.filter((line) => line.includes(requestId));
    expect(ours.map((line) => JSON.parse(line).event)).toEqual(expect.arrayContaining(["request.exported"]));
    // … every line is structured JSON with the fixed key set …
    const allowed = new Set(["level", "time", "event", "requestId", "jobId", "companyId", "documentId", "attempt", "code", "status", "durationMs", "count"]);
    for (const line of lines) for (const key of Object.keys(JSON.parse(line))) expect(allowed, `${key} in ${line}`).toContain(key);
    // … and carries nothing personal or from the documents.
    const all = lines.join("\n");
    for (const secret of SECRETS) expect(all, secret).not.toContain(secret);
  });
});
