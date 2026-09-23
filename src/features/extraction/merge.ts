import type { ExtractResponse, FieldResult } from "./types";

export const HEADER_FIELDS = ["company", "contact_person", "email", "phone", "requested_delivery_date", "additional_requirements"] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

/** Fields of one line item (#22); each with its own status and evidence. */
export const ITEM_FIELDS = ["description", "quantity", "unit", "material", "dimensions"] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];

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

export interface MergedLineItem {
  /** 0-based position within the run: documents in upload order, items in document order. */
  itemIndex: number;
  documentId: string;
  fields: Record<ItemField, FieldResult>;
}

/**
 * Line items of all documents, in upload order. Items are NOT merged across documents – two documents
 * may list similar positions, and only a human can tell duplicates from real repeats (review, #25).
 */
export function mergeLineItems(results: Array<{ documentId: string; response: ExtractResponse }>): MergedLineItem[] {
  return results.flatMap(({ documentId, response }) =>
    [...response.lineItems].sort((a, b) => a.index - b.index).map(({ index: _index, ...fields }) => ({ documentId, fields })),
  ).map((item, itemIndex) => ({ itemIndex, ...item }));
}
