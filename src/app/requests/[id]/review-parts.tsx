import type { ReviewField, ReviewStatus, ReviewView } from "@/features/review";

// Presentational parts of the review page (#8, #23, #25), split out of page.tsx (#52).

const ATTACHMENT_ERROR: Record<string, string> = {
  unsupported_media_type: "Format nicht unterstützt",
  document_unparseable: "Datei beschädigt oder unlesbar",
  document_too_long: "zu umfangreich",
  nesting_too_deep: "zu tief verschachtelt",
  too_many_attachments: "zu viele Anhänge",
  not_attached_by_value: "nur verlinkt, nicht angehängt",
  budget_exceeded: "Verarbeitungsgrenze der Nachricht erreicht",
};

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  corrected: "korrigiert",
  found: "belegt",
  uncertain: "unsicher",
  missing: "fehlt",
  unverified: "nicht bestätigt",
};

export const needsAttention = (field: ReviewField): boolean => field.reviewStatus === "unverified" || field.reviewStatus === "uncertain";

export function StatusBadge({ status }: { status: ReviewStatus }) {
  // Uncertain and unverified are the ones a clerk must look at: prominent colour + text, never colour only.
  return (
    <span className={`badge badge-${status}`} data-testid={`status-${status}`}>
      {status === "unverified" || status === "uncertain" ? "⚠ " : ""}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Source({ field }: { field: ReviewField }) {
  if (!field.source) return <p className="muted">Für diesen Wert gibt es keine Fundstelle.</p>;
  const { source } = field;
  return (
    <section aria-labelledby="source-heading" className="source">
      <h3 id="source-heading">
        Quelle: {source.filename} – {source.heading}
      </h3>
      {source.ocr && (
        <p role="note">
          <strong>⚠ Texterkennung (OCR):</strong> Der Text stammt aus einem gescannten Dokument – bitte mit dem Original vergleichen.
        </p>
      )}
      {field.corrected && <p>Fundstelle des erkannten Werts „{field.extractedValue ?? "–"}“ – der aktuelle Wert wurde manuell korrigiert.</p>}
      <ol className="source-lines">
        {source.lines.map((line) => (
          <li key={line.segmentId} className={line.cited ? "cited" : undefined} aria-current={line.cited ? "true" : undefined}>
            <span className="line-label">{line.label}</span>{" "}
            {line.parts.map((part, index) => (part.mark ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
          </li>
        ))}
      </ol>
      <p>
        <a href={`/api/documents/${source.documentId}`}>Original öffnen</a>
      </p>
    </section>
  );
}

type DocumentsProps = Pick<ReviewView, "documents" | "skippedDocuments" | "documentNotes">;

export function DocumentList({ documents, skippedDocuments, documentNotes }: DocumentsProps) {
  return (
    <ul className="doc-list">
      {documents.map((document) => {
        const skipped = skippedDocuments.find((entry) => entry.documentId === document.id);
        const notes = documentNotes.find((entry) => entry.documentId === document.id);
        return (
          <li key={document.id}>
            <a href={`/api/documents/${document.id}`}>{document.filename}</a> <small>({Math.ceil(document.sizeBytes / 1024)} KB)</small>
            {skipped && <small> – nicht automatisch ausgewertet</small>}
            {notes && notes.warnings.includes("ocr_pages_skipped") && <small> – nur die ersten Scan-Seiten wurden per Texterkennung gelesen</small>}
            {notes && notes.failedAttachments.length > 0 && (
              <ul>
                {notes.failedAttachments.map((attachment, index) => (
                  <li key={index} role="note">
                    ⚠ Anhang „{attachment.name ?? `Nr. ${index + 1}`}“ konnte nicht gelesen werden ({ATTACHMENT_ERROR[attachment.error ?? ""] ?? "unbekannter Grund"}) – bitte im Original prüfen.
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
