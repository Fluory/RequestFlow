// Units as the ERP expects them (#96). A unit correction folds a known spelling to the canonical unit
// exactly like the AI service does for extracted values (`canonical_unit` in
// services/ai/src/requestflow_ai/grounding/values.py); a parity test keeps both tables in step.
// An unknown unit stays as entered – the ERP contract accepts it as written.

/** Canonical unit → spellings, compared normalised and without a trailing dot. */
export const UNIT_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  mm: ["mm", "millimeter", "millimetre"],
  cm: ["cm", "zentimeter", "centimeter", "centimetre"],
  m: ["m", "meter", "metre"],
  kg: ["kg", "kilogramm", "kilogram"],
  t: ["t", "tonne", "tonnen", "tonnes"],
  pcs: ["pcs", "pc", "piece", "pieces", "stk", "stck", "st", "stück", "stueck"],
};

const UNITS = new Map(Object.entries(UNIT_SPELLINGS).flatMap(([canonical, spellings]) => spellings.map((spelling) => [spelling, canonical] as const)));

/** The canonical unit for a known spelling, else null. */
export function canonicalUnit(text: string): string | null {
  // As normalize_text: compatibility forms, soft hyphens, whitespace, case; then one trailing dot.
  const key = text.normalize("NFKC").replaceAll("­", "").replace(/\s+/g, " ").trim().toLowerCase().replace(/\.$/, "");
  return UNITS.get(key) ?? null;
}
