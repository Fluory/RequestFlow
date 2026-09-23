import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { errorCodes, quoteRequestSchema, type QuoteRequestReceipt } from "@/features/export";

// Simulated ERP (ADR-0001 D9): an idempotent receiver for `POST /v1/quote-requests`. A repeated call
// with the same Idempotency-Key and body returns the SAME reference – never a second record. Faults
// can be injected to demonstrate retries. Synthetic data only; nothing is logged.

export interface MockRecord {
  bodyHash: string;
  receipt: QuoteRequestReceipt;
}

/** Where the mock keeps its keys. In memory for the pilot (decision-needed in #9) – swappable. */
export interface MockStore {
  get(key: string): MockRecord | undefined;
  set(key: string, record: MockRecord): void;
  size(): number;
}

export class MemoryMockStore implements MockStore {
  private readonly records = new Map<string, MockRecord>();
  get(key: string) {
    return this.records.get(key);
  }
  set(key: string, record: MockRecord) {
    this.records.set(key, record);
  }
  size() {
    return this.records.size;
  }
}

/** `503`: fail before storing · `lost`: store, then answer 503 (the caller never sees the reference) · `timeout`: hang. */
export type MockFault = "503" | "lost" | "timeout";
const FAULTS: readonly MockFault[] = ["503", "lost", "timeout"];

export function parseFaults(value: string): MockFault[] {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.every((entry): entry is MockFault => (FAULTS as readonly string[]).includes(entry))) {
    throw new Error("Invalid or missing configuration: ERP_MOCK_FAULTS");
  }
  return entries;
}

export interface ErpMockOptions {
  token: string;
  store: MockStore;
  /** Consumed one per accepted call, in order. */
  faults?: MockFault[];
  /** How long a `timeout` fault hangs unless the caller aborts first. */
  hangMs?: number;
  /** Memory bound: new keys are refused (503) once the store holds this many records. */
  maxRecords?: number;
}

export interface ErpMock {
  handle(request: Request): Promise<Response>;
  /** Number of records created (for tests and the demo). */
  created(): number;
}

type ErrorCode = (typeof errorCodes)[number];
const json = (status: number, body: unknown) => Response.json(body, { status });
const failure = (status: number, code: ErrorCode, message: string) => json(status, { error: { code, message } });
const digest = (value: string) => createHash("sha256").update(value).digest();
/** Constant-time comparison of the bearer token (digests have equal length). */
const tokenMatches = (header: string | null, token: string) => timingSafeEqual(digest(header ?? ""), digest(`Bearer ${token}`));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createErpMock(options: ErpMockOptions): ErpMock {
  const faults = [...(options.faults ?? [])];
  const hangMs = options.hangMs ?? 60_000;
  const maxRecords = options.maxRecords ?? 10_000;
  const { store } = options;

  return {
    created: () => store.size(),
    async handle(request) {
      if (!tokenMatches(request.headers.get("authorization"), options.token)) return failure(401, "unauthorized", "missing or wrong bearer token");
      const key = request.headers.get("idempotency-key") ?? "";
      if (!UUID.test(key)) return failure(400, "invalid_request", "Idempotency-Key must be a UUID");
      const parsed = quoteRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return failure(400, "invalid_request", "body does not match the contract");
      if (parsed.data.requestId.toLowerCase() !== key.toLowerCase()) return failure(400, "invalid_request", "Idempotency-Key must be the requestId");

      const fault = faults.shift();
      if (fault === "503") return failure(503, "unavailable", "injected fault");
      if (fault === "timeout") {
        await sleep(hangMs, undefined, { signal: request.signal }).catch(() => undefined);
        return failure(503, "unavailable", "injected timeout");
      }

      const bodyHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
      const existing = store.get(key);
      if (existing) {
        if (existing.bodyHash !== bodyHash) return failure(409, "idempotency_conflict", "key was used with a different body");
        return fault === "lost" ? failure(503, "unavailable", "injected lost response") : json(200, existing.receipt);
      }
      if (store.size() >= maxRecords) return failure(503, "unavailable", "mock store is full");
      const receipt: QuoteRequestReceipt = {
        erpReference: `QR-${randomBytes(5).toString("hex").toUpperCase()}`,
        requestId: parsed.data.requestId,
        receivedAt: new Date().toISOString(),
      };
      store.set(key, { bodyHash, receipt });
      return fault === "lost" ? failure(503, "unavailable", "injected lost response") : json(201, receipt);
    },
  };
}
