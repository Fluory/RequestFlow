import type { FieldResult } from "@/features/extraction";
import type { ReviewStatus } from "@/features/review";

// Why a value needs a look, in plain language (#74). The reasons are the AI service's grounding verifier's
// (contract `FieldResult.reason`); the record type makes a new contract reason a type error here.
const REASON: Record<NonNullable<FieldResult["reason"]>, string> = {
  missing_with_value: "Als fehlend gemeldet, aber mit einem Wert – widersprüchlich.",
  no_value: "Als gefunden gemeldet, aber ohne Wert.",
  no_evidence: "Keine Fundstelle angegeben.",
  unknown_segment: "Die angegebene Fundstelle gibt es in der Quelle nicht.",
  empty_quote: "Die Fundstelle enthält kein Zitat.",
  quote_not_in_segment: "Zitat nicht in der Quelle gefunden.",
  value_not_in_quote: "Der Wert steht nicht im zitierten Text.",
  ambiguous_quote: "Die Fundstelle nennt mehrere Daten – bitte prüfen, welches gemeint ist.",
  calendar_week_only: "Kalenderwoche ohne Datum – bitte das genaue Datum klären.",
  ocr_only: "Nur per Texterkennung aus einem Scan gelesen – bitte mit dem Original vergleichen.",
};

const BY_STATUS: Partial<Record<ReviewStatus, string>> = {
  uncertain: "Die KI war sich bei diesem Wert nicht sicher.",
  missing: "In den Unterlagen nicht gefunden.",
  unverified: "Der Wert ließ sich an keiner Fundstelle bestätigen.",
};

/** For an uncertain, missing or unverified value; null for a confirmed or corrected one. */
export function reasonText(field: { reviewStatus: ReviewStatus; reason: string | null }): string | null {
  const fallback = BY_STATUS[field.reviewStatus];
  if (fallback === undefined) return null;
  return field.reason !== null && Object.hasOwn(REASON, field.reason) ? REASON[field.reason as keyof typeof REASON] : fallback;
}
