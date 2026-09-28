// How a value reads on the review screen (#77). Units are stored canonical – mm, cm, m, kg, t, pcs – because
// the ERP contract expects them; only "pcs" reads differently in German. The stored value stays canonical:
// the correction input may show „Stk.“, because a correction folds it back to pcs (#96).
const UNIT_LABEL: Record<string, string> = { pcs: "Stk." };

export function displayValue(field: { key: string; value: string | null }): string | null {
  if (field.key !== "unit" || field.value === null) return field.value;
  return Object.hasOwn(UNIT_LABEL, field.value) ? UNIT_LABEL[field.value]! : field.value;
}
