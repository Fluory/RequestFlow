import type { ReviewField, ReviewStatus, ReviewView } from "@/features/review";

// Presentational parts of the review page (#8, #23, #25), styled after design prototype A (#52).

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
  // Uncertain and unverified are the ones a clerk must look at: warning sign + outlined tag, never colour only.
  return (
    <span className={`badge badge-${status}`} data-testid={`status-${status}`}>
      {status === "unverified" || status === "uncertain" ? "⚠ " : ""}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Source of the selected value: document, heading and the cited lines with the value marked. */
export function Source({ field }: { field: ReviewField }) {
  if (!field.source) return <p className="muted">Für diesen Wert gibt es keine Fundstelle.</p>;
  const { source } = field;
  return (
    <section aria-labelledby="source-heading" className="panel-source">
      <div className="source-head">
        <span className="label">Quelle</span>
        <strong id="source-heading">
          {source.filename} – {source.heading}
        </strong>
      </div>
      {source.ocr && (
        <p role="note">
          <strong>⚠ Texterkennung (OCR):</strong> Der Text stammt aus einem gescannten Dokument – bitte mit dem Original vergleichen.
        </p>
      )}
      {field.corrected && <p className="field-hint">Fundstelle des erkannten Werts „{field.extractedValue ?? "–"}“ – der aktuelle Wert wurde manuell korrigiert.</p>}
      <ol className="source-lines">
        {source.lines.map((line) => (
          <li key={line.segmentId} className={line.cited ? "cited" : undefined} aria-current={line.cited ? "true" : undefined}>
            <span className="line-label">{line.label}</span>
            <span className="line-text">
              {line.parts.map((part, index) => (part.mark ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
            </span>
          </li>
        ))}
      </ol>
      <a href={`/api/documents/${source.documentId}`}>Original öffnen</a>
    </section>
  );
}

type DocumentsProps = Pick<ReviewView, "documents" | "skippedDocuments" | "documentNotes">;

export function DocumentList({ documents, skippedDocuments, documentNotes }: DocumentsProps) {
  return (
    <div>
      {documents.map((document) => {
        const skipped = skippedDocuments.find((entry) => entry.documentId === document.id);
        const notes = documentNotes.find((entry) => entry.documentId === document.id);
        return (
          <div key={document.id} className="doc-row">
            <div>
              <a href={`/api/documents/${document.id}`}>{document.filename}</a>
              <span className="mono muted">{Math.ceil(document.sizeBytes / 1024)} KB</span>
            </div>
            {skipped && <div className="doc-note">⚠ Nicht automatisch ausgewertet.</div>}
            {notes && notes.warnings.includes("ocr_pages_skipped") && <div className="doc-note">⚠ Nur die ersten Scan-Seiten wurden per Texterkennung gelesen.</div>}
            {notes?.failedAttachments.map((attachment, index) => (
              <div key={index} role="note" className="doc-note">
                ⚠ Anhang „{attachment.name ?? `Nr. ${index + 1}`}“ konnte nicht gelesen werden ({ATTACHMENT_ERROR[attachment.error ?? ""] ?? "unbekannter Grund"}) – bitte im Original prüfen.
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
