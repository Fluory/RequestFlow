import type { ExtractResponse, FieldResult } from "./index";

export const HEADER_FIELDS = ["company", "contact_person", "requested_delivery_date"] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

export interface MergedField extends FieldResult {
  documentId: string | null;
}

// found > uncertain > unverified > missing: a value the verifier could not confirm never replaces
// a confirmed one, and "found" still only comes from the AI service's verifier (ADR-0001 D8).
const RANK: Record<FieldResult["status"], number> = { found: 3, uncertain: 2, unverified: 1, missing: 0 };

export function mergeFields(results: Array<{ documentId: string; response: ExtractResponse }>): Record<HeaderField, MergedField> {
  const merged = {} as Record<HeaderField, MergedField>;
  for (const key of HEADER_FIELDS) {
    let best: MergedField = { value: null, status: "missing", evidence: null, modelStatus: "missing", reason: null, documentId: null };
    for (const { documentId, response } of results) {
      const candidate = response.fields[key];
      if (RANK[candidate.status] > RANK[best.status]) best = { ...candidate, documentId };
    }
    merged[key] = best;
  }
  return merged;
}
