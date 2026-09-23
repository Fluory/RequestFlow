import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { loadReview, REJECTION_REASON_MAX, type ReviewField, type ReviewStatus } from "@/features/review";
import { requestStatusLabel } from "../status-labels";
import { DONE_MESSAGES, ERROR_MESSAGES, messageFor } from "./messages";
import { approveAction, correctFieldAction, rejectAction } from "./actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ATTACHMENT_ERROR: Record<string, string> = {
  unsupported_media_type: "Format nicht unterstützt",
  document_unparseable: "Datei beschädigt oder unlesbar",
  document_too_long: "zu umfangreich",
  nesting_too_deep: "zu tief verschachtelt",
  too_many_attachments: "zu viele Anhänge",
  not_attached_by_value: "nur verlinkt, nicht angehängt",
  budget_exceeded: "Verarbeitungsgrenze der Nachricht erreicht",
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  corrected: "korrigiert",
  found: "belegt",
  uncertain: "unsicher",
  missing: "fehlt",
  unverified: "nicht bestätigt",
};

function StatusBadge({ status }: { status: ReviewStatus }) {
  // Uncertain and unverified are the ones a clerk must look at: prominent colour + text, never colour only.
  return (
    <span className={`badge badge-${status}`} data-testid={`status-${status}`}>
      {status === "unverified" || status === "uncertain" ? "⚠ " : ""}
      {STATUS_LABEL[status]}
    </span>
  );
}

function Source({ field }: { field: ReviewField }) {
  if (!field.source) return <p>Für diesen Wert gibt es keine Fundstelle.</p>;
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

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const view = await loadReview(getRuntime().tenancy, actor, id);
  if (!view) notFound();
  const { request, fields, lineItems, documents, skippedDocuments, documentNotes, exportRecord } = view;
  const query = await searchParams;
  // `?field=<key>` selects a header field, `?field=<key>&item=<n>` a line-item field (#25).
  const selectedItem = query.item !== undefined && /^\d{1,4}$/.test(query.item) ? Number(query.item) : null;
  const selected =
    selectedItem === null
      ? fields.find((field) => field.key === query.field)
      : lineItems.find((item) => item.itemIndex === selectedItem)?.fields.find((field) => field.key === query.field);
  const inReview = request.status === "REVIEW";
  const done = messageFor(DONE_MESSAGES, query.done);
  const error = messageFor(ERROR_MESSAGES, query.error);

  return (
    <main>
      <p>
        <Link href="/requests">← Anfragen</Link>
      </p>
      <h1>{request.subject ?? "(ohne Betreff)"}</h1>
      <p>
        Status: <strong data-testid="request-status">{requestStatusLabel(request.status)}</strong>
      </p>
      {done && <p role="status">{done}</p>}
      {error && <p role="alert">{error}</p>}
      {request.status === "ERROR" && request.errorMessage && <p role="alert">Fehler: {request.errorMessage}</p>}
      {request.status === "REJECTED" && request.rejectionReason && <p>Abgelehnt: {request.rejectionReason}</p>}
      {exportRecord?.erpReference && (
        <p>
          ERP-Referenz: <strong data-testid="erp-reference">{exportRecord.erpReference}</strong>
        </p>
      )}
      {request.status === "APPROVED" && exportRecord?.lastError && (
        <p role="status">
          Export wird wiederholt ({exportRecord.attempts} Versuche bisher): {exportRecord.lastError}
        </p>
      )}
      {request.possibleDuplicate && request.duplicateOfId && (
        <p role="note">
          Mögliches Duplikat von <Link href={`/requests/${request.duplicateOfId}`}>dieser Anfrage</Link>.
        </p>
      )}

      {fields.length > 0 && (
        <>
          <h2>Erkannte Angaben</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Feld</th>
                <th scope="col">Wert</th>
                <th scope="col">Status</th>
                <th scope="col">Quelle</th>
                {inReview && <th scope="col">Korrektur</th>}
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.key} className={field.reviewStatus === "unverified" || field.reviewStatus === "uncertain" ? "attention" : undefined}>
                  <th scope="row">{field.label}</th>
                  <td data-testid={`value-${field.key}`}>
                    {field.value ?? "–"}
                    {field.corrected && <small> (korrigiert; erkannt: {field.extractedValue ?? "–"})</small>}
                  </td>
                  <td>
                    <StatusBadge status={field.reviewStatus} />
                    {field.corrected && <small> (erkannt: {STATUS_LABEL[field.status]})</small>}
                  </td>
                  <td>{field.source ? <Link href={`/requests/${request.id}?field=${field.key}`}>Quelle anzeigen</Link> : "–"}</td>
                  {inReview && (
                    <td>
                      <form action={correctFieldAction}>
                        <input type="hidden" name="requestId" value={request.id} />
                        <input type="hidden" name="field" value={field.key} />
                        <label>
                          <span className="visually-hidden">Neuer Wert für {field.label}</span>
                          <input name="value" defaultValue={field.value ?? ""} maxLength={500} />
                        </label>{" "}
                        <button type="submit">Speichern</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {selected && selected.itemIndex === null && <Source field={selected} />}
        </>
      )}

      {lineItems.length > 0 && (
        <>
          <h2>Positionen</h2>
          <table data-testid="line-items">
            <thead>
              <tr>
                <th scope="col">Pos.</th>
                {lineItems[0]!.fields.map((field) => (
                  <th scope="col" key={field.key}>
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.itemIndex}>
                  <th scope="row">{item.itemIndex + 1}</th>
                  {item.fields.map((field) => (
                    <td
                      key={field.key}
                      data-testid={`item-${item.itemIndex}-${field.key}`}
                      className={field.reviewStatus === "unverified" || field.reviewStatus === "uncertain" ? "attention" : undefined}
                    >
                      {/* The accessible name contains the visible value (WCAG 2.5.3 label in name). */}
                      <Link
                        href={`/requests/${request.id}?field=${field.key}&item=${item.itemIndex}`}
                        aria-label={`Position ${item.itemIndex + 1}, ${field.label}: ${field.value ?? "–"}`}
                      >
                        {field.value ?? "–"}
                      </Link>{" "}
                      <StatusBadge status={field.reviewStatus} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {selected && selected.itemIndex !== null && (
            <section aria-labelledby="item-field-heading">
              <h3 id="item-field-heading">
                Position {selected.itemIndex + 1}: {selected.label}
              </h3>
              <p>
                Wert: <strong data-testid="selected-item-value">{selected.value ?? "–"}</strong> <StatusBadge status={selected.reviewStatus} />
                {selected.corrected && <small> (erkannt: {selected.extractedValue ?? "–"}, {STATUS_LABEL[selected.status]})</small>}
              </p>
              {inReview && (
                <form action={correctFieldAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="field" value={selected.key} />
                  <input type="hidden" name="item" value={selected.itemIndex} />
                  <label>
                    Neuer Wert für Position {selected.itemIndex + 1}, {selected.label}{" "}
                    <input name="value" defaultValue={selected.value ?? ""} maxLength={500} />
                  </label>{" "}
                  <button type="submit">Speichern</button>
                </form>
              )}
              <Source field={selected} />
            </section>
          )}
        </>
      )}

      {inReview && (
        <section aria-labelledby="decision-heading">
          <h2 id="decision-heading">Entscheidung</h2>
          <form action={approveAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <button type="submit">Freigeben</button>
          </form>
          <form action={rejectAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <label>
              Grund der Ablehnung <input name="reason" required maxLength={REJECTION_REASON_MAX} />
            </label>{" "}
            <button type="submit">Ablehnen</button>
          </form>
        </section>
      )}

      <h2>Dokumente</h2>
      <ul>
        {documents.map((document) => {
          const skipped = skippedDocuments.find((entry) => entry.documentId === document.id);
          const notes = documentNotes.find((entry) => entry.documentId === document.id);
          return (
            <li key={document.id}>
              <a href={`/api/documents/${document.id}`}>{document.filename}</a> ({Math.ceil(document.sizeBytes / 1024)} KB)
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
    </main>
  );
}
