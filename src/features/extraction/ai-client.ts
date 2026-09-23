import { z } from "zod";
import type { ExtractResponse } from "./types";

// Client of the stateless AI service (contract: contracts/ai-service.openapi.yaml, types generated in
// ./ai-service.contract.ts). Every call has a timeout. Errors are classified for the job runner:
// retryable (timeout, unreachable, 429, 5xx) → pg-boss retries with backoff; permanent → no retry.
export interface AiServiceSettings {
  baseUrl: string;
  token: string | undefined;
  timeoutMs: number;
}

export interface ExtractInput {
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
  documentId: string;
  /** Propagated as X-Request-Id (correlation across web → worker → AI service). */
  correlationId: string;
}

export class AiServiceError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    /** `document`: this document cannot be processed; `service`: the call itself is misconfigured. */
    readonly scope: "document" | "service",
    readonly status?: number,
  ) {
    super(`AI service error: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "AiServiceError";
  }
}

const fieldResult = z.object({
  value: z.string().nullable(),
  status: z.enum(["found", "uncertain", "missing", "unverified"]),
  evidence: z.object({ segmentId: z.string(), quote: z.string() }).nullable(),
  modelStatus: z.enum(["found", "uncertain", "missing"]),
  reason: z.string().nullable(),
});
const responseSchema = z.object({
  documentId: z.string(),
  documentKind: z.enum(["pdf", "eml"]),
  segments: z.array(z.object({ id: z.string(), text: z.string(), locator: z.record(z.string(), z.unknown()) })),
  fields: z.object({
    company: fieldResult,
    contact_person: fieldResult,
    email: fieldResult,
    phone: fieldResult,
    requested_delivery_date: fieldResult,
    additional_requirements: fieldResult,
  }),
  // Line items (#22, schema version 2): each item field carries its own status and evidence.
  lineItems: z.array(
    z.object({ index: z.number().int().min(0), description: fieldResult, quantity: fieldResult, unit: fieldResult, material: fieldResult, dimensions: fieldResult }),
  ),
  run: z.object({ modelId: z.string(), promptVersion: z.string(), schemaVersion: z.string(), latencyMs: z.number() }).loose(),
  warnings: z.array(z.string()),
}).loose();

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const DOCUMENT_STATUS = new Set([413, 415, 422]);

/**
 * Invariants the contract promises beyond the shape: `found` has evidence, evidence cites a returned
 * segment, segment ids are unique, the response belongs to the document sent. A violation would never
 * succeed on retry, so it is permanent.
 */
function consistent(response: z.infer<typeof responseSchema>, documentId: string): boolean {
  if (response.documentId !== documentId) return false;
  const ids = new Set(response.segments.map((segment) => segment.id));
  if (ids.size !== response.segments.length) return false;
  const itemFields = response.lineItems.flatMap(({ index: _index, ...fields }) => Object.values(fields));
  return [...Object.values(response.fields), ...itemFields].every(
    (field) => (field.status !== "found" || field.evidence !== null) && (field.evidence === null || ids.has(field.evidence.segmentId)),
  );
}

export interface AiServiceClient {
  extract(input: ExtractInput): Promise<ExtractResponse>;
}

export function createAiServiceClient(settings: AiServiceSettings): AiServiceClient {
  if (!settings.token) throw new Error("Invalid or missing configuration: AI_SERVICE_TOKEN");
  const url = new URL("/v1/extract", settings.baseUrl);
  const token = settings.token;

  return {
    async extract(input) {
      const form = new FormData();
      form.append("documentId", input.documentId);
      form.append("mediaType", input.mediaType);
      form.append("file", new Blob([input.bytes as BlobPart], { type: input.mediaType }), input.filename);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "x-request-id": input.correlationId },
          body: form,
          signal: AbortSignal.timeout(settings.timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new AiServiceError(timedOut ? "timeout" : "unreachable", true, "service");
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (RETRYABLE_STATUS.has(response.status)) throw new AiServiceError("unavailable", true, "service", response.status);
        // Only these say "this document": everything else (400, 401, 403, 404, 405, …) points at the
        // call itself – a misconfigured URL or client bug must not look like unreadable documents.
        const scope = DOCUMENT_STATUS.has(response.status) ? "document" : "service";
        throw new AiServiceError("rejected", false, scope, response.status);
      }
      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success || !consistent(parsed.data, input.documentId)) {
        throw new AiServiceError("contract_violation", false, "service", response.status);
      }
      return parsed.data as unknown as ExtractResponse;
    },
  };
}

/** Reachability of the AI service (`GET /healthz`, open endpoint) for /api/health (#28). */
export async function pingAiService(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(new URL("/healthz", baseUrl), { signal: AbortSignal.timeout(2_000) });
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) throw new Error(`AI service health: HTTP ${response.status}`);
}
