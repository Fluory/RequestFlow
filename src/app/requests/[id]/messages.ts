// Fixed feedback texts of the review screen. Actions redirect with a code; the page shows only the
// text mapped here, so a crafted link cannot put its own words into an alert (review of #8).
export const DONE_MESSAGES: Record<string, string> = {
  corrected: "Korrektur gespeichert.",
  approved: "Freigegeben – der Export ist eingeplant.",
  rejected: "Abgelehnt.",
  not_duplicate: "Als eigenständige Anfrage bestätigt.",
};

export const ERROR_MESSAGES: Record<string, string> = {
  not_in_review: "Diese Anfrage kann in ihrem aktuellen Status nicht geprüft werden.",
  unknown_field: "Unbekanntes Feld.",
  reason_missing: "Bitte einen Grund für die Ablehnung angeben.",
  reason_too_long: "Der Grund ist zu lang (höchstens 1000 Zeichen).",
  value_too_long: "Ein Wert ist zu lang für den ERP-Export (höchstens 500 Zeichen) – bitte zuerst korrigieren.",
  duplicate_undecided: "Mögliches Duplikat – bitte zuerst entscheiden, ob es eine eigenständige Anfrage ist.",
  not_a_possible_duplicate: "Für diese Anfrage steht keine Duplikat-Entscheidung an.",
  forbidden: "Keine Berechtigung.",
};

export const messageFor = (table: Record<string, string>, code: string | undefined): string | undefined =>
  code !== undefined && Object.hasOwn(table, code) ? table[code] : undefined;
