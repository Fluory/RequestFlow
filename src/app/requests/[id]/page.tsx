import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRuntime, requestActor } from "@/app/_server/runtime";
import { duplicateDecidable, loadReview, REJECTION_REASON_MAX, type ReviewField } from "@/features/review";
import { StatusPill } from "../status-pill";
import { DONE_MESSAGES, ERROR_MESSAGES, messageFor } from "./messages";
import { approveAction, confirmNotDuplicateAction, correctFieldAction, rejectAction, rejectAsDuplicateAction } from "./actions";
import { DocumentList, needsAttention, Source, STATUS_LABEL, StatusBadge } from "./review-parts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const NO_FIELDS: Record<string, string> = {
  NEW: "Die Anfrage wartet auf die Verarbeitung. Erkannte Angaben erscheinen danach hier.",
  PROCESSING: "Die Dokumente werden gerade ausgewertet.",
};

// Review page (#8, #25), layout after design prototype A (#52): fields, positions and documents on the
// left; the selected value with its source and the decision in a sticky panel on the right.
export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requestActor();
  if (!actor) redirect("/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const view = await loadReview(getRuntime().tenancy, actor, id);
  if (!view) notFound();
  const { request, fields, lineItems, documents, skippedDocuments, documentNotes, exportRecord } = view;
  const query = await searchParams;
  // `?field=<key>` selects a header field, `?field=<key>&item=<n>` a line-item field (#25). Without a
  // selection the panel shows the first value that needs attention, else the first field.
  const selectedItem = query.item !== undefined && /^\d{1,4}$/.test(query.item) ? Number(query.item) : null;
  const requested: ReviewField | undefined =
    selectedItem === null
      ? fields.find((field) => field.key === query.field)
      : lineItems.find((item) => item.itemIndex === selectedItem)?.fields.find((field) => field.key === query.field);
  const selected = requested ?? fields.find(needsAttention) ?? fields[0];
  const isSelected = (field: ReviewField) => selected !== undefined && selected.key === field.key && selected.itemIndex === field.itemIndex;
  const inReview = request.status === "REVIEW";
  // Decidable before approval and not while a worker holds the request (status machine, #27).
  const canDecideDuplicate = duplicateDecidable(request);
  const done = messageFor(DONE_MESSAGES, query.done);
  const error = messageFor(ERROR_MESSAGES, query.error);
  const openItems = lineItems.reduce((count, item) => count + item.fields.filter(needsAttention).length, fields.filter(needsAttention).length);
  const fieldHref = (field: ReviewField) =>
    field.itemIndex === null ? `/requests/${request.id}?field=${field.key}` : `/requests/${request.id}?field=${field.key}&item=${field.itemIndex}`;

  return (
    <main>
      <Link href="/requests" className="back">
        ← Anfragen
      </Link>
      <div className="review-head">
        <h1>{request.subject ?? "(ohne Betreff)"}</h1>
        <div className="review-meta">
          <StatusPill status={request.status} testId="request-status" />
          {exportRecord?.erpReference && (
            <span className="erp">
              ERP-Referenz <strong data-testid="erp-reference">{exportRecord.erpReference}</strong>
            </span>
          )}
          {inReview && openItems > 0 && (
            <span className="attention-tag">⚠ {openItems === 1 ? "1 Wert braucht Aufmerksamkeit" : `${openItems} Werte brauchen Aufmerksamkeit`}</span>
          )}
          <span>Eingang {dateFormat.format(request.createdAt)}</span>
        </div>
      </div>
      {done && <p role="status">{done}</p>}
      {error && <p role="alert">{error}</p>}
      {request.status === "ERROR" && request.errorMessage && (
        <p role="alert">
          <strong>Fehler:</strong> {request.errorMessage}
        </p>
      )}
      {request.status === "REJECTED" && request.rejectionReason && (
        <p className="callout callout-grey">
          <strong>Abgelehnt:</strong> {request.rejectionReason}
        </p>
      )}
      {request.status === "APPROVED" && (
        <p className="callout callout-info">
          {exportRecord?.lastError
            ? `Export wird wiederholt (${exportRecord.attempts} Versuche bisher): ${exportRecord.lastError}`
            : "Freigegeben – der Export ist eingeplant."}
        </p>
      )}
      {request.possibleDuplicate && request.duplicateOfId && (
        <section aria-labelledby="duplicate-heading" className="duplicate" data-testid="duplicate-banner">
          <h2 id="duplicate-heading">Mögliches Duplikat</h2>
          <p>
            Gleiche E-Mail oder gleiche Dateien wie <Link href={`/requests/${request.duplicateOfId}`}>diese Anfrage</Link>.
            {request.duplicateDecision === "distinct" && " Entscheidung: eigenständige Anfrage."}
            {request.duplicateDecision === "duplicate" && " Entscheidung: als Duplikat abgelehnt."}
          </p>
          {request.duplicateDecision === null && canDecideDuplicate && (
            <>
              <div className="duplicate-actions">
                <form action={confirmNotDuplicateAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <button type="submit">Kein Duplikat – weiter bearbeiten</button>
                </form>
                <span className="sep" aria-hidden="true" />
                <form action={rejectAsDuplicateAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <label className="field">
                    <span>Grund</span>
                    <input name="reason" required maxLength={REJECTION_REASON_MAX} defaultValue="Duplikat einer bestehenden Anfrage" />
                  </label>
                  <button type="submit" className="btn-danger">
                    Als Duplikat ablehnen
                  </button>
                </form>
              </div>
              <p className="duplicate-hint">Solange nicht entschieden ist, kann die Anfrage nicht freigegeben werden.</p>
            </>
          )}
        </section>
      )}

      <div className="review-grid">
        <div className="review-main">
          {fields.length > 0 ? (
            <>
              <section className="card" aria-labelledby="fields-heading">
                <h2 id="fields-heading" className="card-title">
                  Erkannte Angaben
                </h2>
                <div className="table-wrap">
                  <table className="fields-table">
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
                        <tr key={field.key} className={isSelected(field) ? "selected" : needsAttention(field) ? "attention" : undefined}>
                          <th scope="row">{field.label}</th>
                          <td data-testid={`value-${field.key}`}>
                            {field.value === null ? <span className="muted">–</span> : <Link href={fieldHref(field)} className="value-link">{field.value}</Link>}
                            {field.corrected && <div className="field-hint">erkannt: {field.extractedValue ?? "–"}</div>}
                          </td>
                          <td className="nowrap">
                            <StatusBadge status={field.reviewStatus} />
                          </td>
                          <td className="source-col">{field.source ? <Link href={fieldHref(field)}>Quelle anzeigen</Link> : <span className="muted">–</span>}</td>
                          {inReview && (
                            <td className="correct">
                              <form action={correctFieldAction} className="inline-form">
                                <input type="hidden" name="requestId" value={request.id} />
                                <input type="hidden" name="field" value={field.key} />
                                <label>
                                  <span className="visually-hidden">Neuer Wert für {field.label}</span>
                                  <input name="value" defaultValue={field.value ?? ""} maxLength={500} />
                                </label>
                                <button type="submit" className="btn-small">
                                  Speichern
                                </button>
                              </form>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {lineItems.length > 0 && (
                <section className="card" aria-labelledby="items-heading">
                  <div className="card-title">
                    <h2 id="items-heading">Positionen</h2>
                    <span>Wert anklicken für Fundstelle und Korrektur</span>
                  </div>
                  <div className="table-wrap">
                    <table className="items-table" data-testid="line-items">
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
                            <th scope="row" className="mono">
                              {item.itemIndex + 1}
                            </th>
                            {item.fields.map((field) => (
                              <td key={field.key} data-testid={`item-${item.itemIndex}-${field.key}`} className={needsAttention(field) ? "attention" : undefined}>
                                {/* The accessible name contains the visible value (WCAG 2.5.3 label in name). */}
                                <Link
                                  href={fieldHref(field)}
                                  className="item-cell"
                                  aria-current={isSelected(field) ? "true" : undefined}
                                  aria-label={`Position ${item.itemIndex + 1}, ${field.label}: ${field.value ?? "–"}`}
                                >
                                  <span>{field.value ?? "–"}</span>
                                  <StatusBadge status={field.reviewStatus} />
                                </Link>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          ) : (
            <section className="card card-pad muted">{NO_FIELDS[request.status] ?? "Es liegen keine erkannten Angaben vor."}</section>
          )}

          <section className="card" aria-labelledby="documents-heading">
            <h2 id="documents-heading" className="card-title">
              Dokumente
            </h2>
            <DocumentList documents={documents} skippedDocuments={skippedDocuments} documentNotes={documentNotes} />
          </section>
        </div>

        <aside className="review-aside" aria-label="Fundstelle und Entscheidung">
          {selected && (
            <section className="card panel" aria-labelledby="selected-heading">
              <div>
                <span className="label">{selected.itemIndex === null ? "Erkannte Angabe" : `Position ${selected.itemIndex + 1}`}</span>
                <h2 id="selected-heading" className="big">
                  {selected.label}
                </h2>
              </div>
              <div>
                <div className="panel-value">
                  <strong data-testid={selected.itemIndex === null ? undefined : "selected-item-value"}>{selected.value ?? "–"}</strong>
                  <StatusBadge status={selected.reviewStatus} />
                </div>
                {selected.corrected && (
                  <p className="field-hint">
                    erkannt: {selected.extractedValue ?? "–"} ({STATUS_LABEL[selected.status]})
                  </p>
                )}
              </div>
              {inReview && selected.itemIndex !== null && (
                <form action={correctFieldAction} className="field">
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="field" value={selected.key} />
                  <input type="hidden" name="item" value={selected.itemIndex} />
                  <label htmlFor="item-correction" className="label">
                    Neuer Wert<span className="visually-hidden"> für Position {selected.itemIndex + 1}, {selected.label}</span>
                  </label>
                  <div className="correction-row">
                    <input id="item-correction" name="value" defaultValue={selected.value ?? ""} maxLength={500} />
                    <button type="submit">Speichern</button>
                  </div>
                  <span className="field-hint">Wird mit altem und neuem Wert, Person und Zeit protokolliert.</span>
                </form>
              )}
              <div className="divider" />
              <Source field={selected} />
            </section>
          )}
          {inReview && (
            <section className="card panel decision" aria-labelledby="decision-heading">
              <h2 id="decision-heading">Entscheidung</h2>
              <form action={approveAction}>
                <input type="hidden" name="requestId" value={request.id} />
                <button type="submit" className="btn-primary btn-large">
                  Freigeben
                </button>
                <span className="field-hint">Die Anfrage wird danach genau einmal ans ERP übergeben.</span>
              </form>
              <div className="divider" />
              <form action={rejectAction}>
                <input type="hidden" name="requestId" value={request.id} />
                <label className="field">
                  <span>Grund der Ablehnung (Pflicht)</span>
                  <input name="reason" required maxLength={REJECTION_REASON_MAX} />
                </label>
                <button type="submit" className="btn-danger">
                  Ablehnen
                </button>
              </form>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
