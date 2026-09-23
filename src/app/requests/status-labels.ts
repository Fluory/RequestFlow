// German labels for staff; the stored status stays the English enum.
export const REQUEST_STATUS_LABEL: Record<string, string> = {
  NEW: "Neu",
  PROCESSING: "In Verarbeitung",
  REVIEW: "Zur Prüfung",
  APPROVED: "Freigegeben",
  EXPORTED: "Exportiert",
  REJECTED: "Abgelehnt",
  ERROR: "Fehler",
};

export const requestStatusLabel = (status: string): string => REQUEST_STATUS_LABEL[status] ?? status;
