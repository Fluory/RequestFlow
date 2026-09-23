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
  fields: z.object({ company: fieldResult, contact_person: fieldResult, requested_delivery_date: fieldResult }),
  run: z.object({ modelId: z.string(), promptVersion: z.string(), schemaVersion: z.string(), latencyMs: z.number() }).loose(),
  warnings: z.array(z.string()),
}).loose();

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

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
        const scope = response.status === 401 || response.status === 403 ? "service" : "document";
        throw new AiServiceError("rejected", false, scope, response.status);
      }
      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new AiServiceError("contract_violation", false, "service", response.status);
      return parsed.data as unknown as ExtractResponse;
    },
  };
}
