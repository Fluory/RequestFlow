import { receiptSchema, type QuoteRequest, type QuoteRequestReceipt } from "./contract";

// REST adapter of the ERP port (contract: contracts/erp-export.openapi.yaml). Every call has a timeout
// and carries `Idempotency-Key: <requestId>`, so a retry after an unknown outcome is safe (ADR-0001 D9).
// Errors are classified for the job runner like the AI-service client: retryable → pg-boss retries.
export interface ErpSettings {
  baseUrl: string;
  token: string | undefined;
  timeoutMs: number;
  /** Injected in tests (network boundary). */
  fetch?: typeof fetch;
}

export class ErpExportError extends Error {
  constructor(
    readonly code: "timeout" | "unreachable" | "http" | "contract_violation",
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(`ERP export error: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "ErpExportError";
  }
}

export interface ErpExporter {
  /** `replay`: the ERP had the key already (200) – same reference as the first call. */
  submit(request: QuoteRequest): Promise<{ receipt: QuoteRequestReceipt; replay: boolean }>;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function createErpClient(settings: ErpSettings): ErpExporter {
  if (!settings.token) throw new Error("Invalid or missing configuration: ERP_TOKEN");
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/v1/quote-requests`;
  const token = settings.token;
  const fetchImpl = settings.fetch ?? fetch;

  return {
    async submit(request) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": request.requestId },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(settings.timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new ErpExportError(timedOut ? "timeout" : "unreachable", true);
      }
      if (response.status !== 200 && response.status !== 201) {
        await response.body?.cancel().catch(() => undefined);
        throw new ErpExportError("http", RETRYABLE_STATUS.has(response.status), response.status);
      }
      // A failure while READING the body (timeout, reset) leaves the outcome unknown → retry under the
      // same key; only a body that was read and breaks the contract is permanent.
      let body: string;
      try {
        body = await response.text();
      } catch (error) {
        const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new ErpExportError(timedOut ? "timeout" : "unreachable", true, response.status);
      }
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        json = undefined;
      }
      const parsed = receiptSchema.safeParse(json);
      if (!parsed.success || parsed.data.requestId.toLowerCase() !== request.requestId.toLowerCase()) {
        throw new ErpExportError("contract_violation", false, response.status);
      }
      return { receipt: parsed.data, replay: response.status === 200 };
    },
  };
}
