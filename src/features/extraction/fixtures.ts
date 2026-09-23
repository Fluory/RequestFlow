import type { ExtractResponse } from "./types";

// Synthetic AI-service response in the contract shape (tests and local demos only; no real data).
export function syntheticExtractResponse(documentId: string, overrides: Partial<ExtractResponse["fields"]> = {}): ExtractResponse {
  return {
    requestId: "synthetic-request",
    documentId,
    documentKind: "eml",
    segments: [
      { id: "s1", text: "From: Einkauf <einkauf@example.com>", locator: { kind: "email", part: "header", line: 1, header: "From" } },
      { id: "s2", text: "Musterbau Beispiel GmbH", locator: { kind: "email", part: "body", line: 1, header: null } },
      { id: "s3", text: "Ansprechpartnerin: Erika Beispiel", locator: { kind: "email", part: "body", line: 2, header: null } },
      { id: "s4", text: "Liefertermin: 15.10.2026", locator: { kind: "email", part: "body", line: 3, header: null } },
    ],
    fields: {
      company: { value: "Musterbau Beispiel GmbH", status: "found", evidence: { segmentId: "s2", quote: "Musterbau Beispiel GmbH" }, modelStatus: "found", reason: null },
      contact_person: { value: "Erika Beispiel", status: "found", evidence: { segmentId: "s3", quote: "Erika Beispiel" }, modelStatus: "found", reason: null },
      requested_delivery_date: { value: "2026-10-15", status: "found", evidence: { segmentId: "s4", quote: "15.10.2026" }, modelStatus: "found", reason: null },
      ...overrides,
    },
    run: {
      modelId: "gemini-3.5-flash",
      modelVersion: null,
      promptVersion: "extract_header_v1",
      schemaVersion: "1",
      pdfPipeline: null,
      tokens: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 },
      latencyMs: 850,
      modelLatencyMs: 700,
    },
    warnings: [],
  };
}
