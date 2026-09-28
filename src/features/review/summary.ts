import { HEADER_FIELDS } from "@/features/extraction";

// What the request list shows per request (#77): customer and need for review – with the same rules as
// the review page, so list and detail never tell a different story (the lesson of #70).
export interface SummaryField {
  fieldKey: string;
  itemIndex: number | null;
  value: string | null;
  status: "found" | "uncertain" | "missing" | "unverified";
}

export interface SummaryCorrection {
  fieldKey: string;
  itemIndex: number | null;
  newValue: string | null;
  createdAt: Date;
}

export interface ReviewSummary {
  /** The extracted company, or its latest correction. */
  company: string | null;
  /** Values the clerk must look at: uncertain or unverified and not corrected – "n Werte brauchen Aufmerksamkeit". */
  attention: number;
  /** Header fields without a value and without a correction. */
  missing: number;
}

/** Corrections are per field and – for line items – per position (#25). */
export const correctionKey = (fieldKey: string, itemIndex: number | null) => (itemIndex === null ? fieldKey : `${fieldKey}#${itemIndex}`);

/**
 * The correction that applies to a field of a run: the latest one – except for a position, where a
 * correction made before a newer run is not mapped onto it (positions belong to one run).
 */
export function applicableCorrection<C extends { createdAt: Date }>(stored: C | undefined, itemIndex: number | null, runCreatedAt: Date): C | undefined {
  return itemIndex !== null && stored && stored.createdAt < runCreatedAt ? undefined : stored;
}

/** Latest correction per field and position; input in any order. */
export function latestCorrections<C extends { fieldKey: string; itemIndex: number | null; createdAt: Date }>(corrections: readonly C[]): Map<string, C> {
  const latest = new Map<string, C>();
  for (const correction of [...corrections].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    latest.set(correctionKey(correction.fieldKey, correction.itemIndex), correction);
  }
  return latest;
}

export function summarizeReview(run: { createdAt: Date; fields: readonly SummaryField[] } | null, corrections: readonly SummaryCorrection[]): ReviewSummary {
  if (!run) return { company: null, attention: 0, missing: 0 };
  const latest = latestCorrections(corrections);
  const correctionOf = (fieldKey: string, itemIndex: number | null) => applicableCorrection(latest.get(correctionKey(fieldKey, itemIndex)), itemIndex, run.createdAt);

  const company = run.fields.find((field) => field.fieldKey === "company" && field.itemIndex === null);
  const companyCorrection = correctionOf("company", null);
  const attention = run.fields.filter(
    (field) => (field.status === "uncertain" || field.status === "unverified") && !correctionOf(field.fieldKey, field.itemIndex),
  ).length;
  const missing = HEADER_FIELDS.filter((key) => {
    const extracted = run.fields.find((field) => field.fieldKey === key && field.itemIndex === null);
    return (!extracted || extracted.status === "missing") && !correctionOf(key, null);
  }).length;

  return { company: companyCorrection ? companyCorrection.newValue : (company?.value ?? null), attention, missing };
}
