import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRuntime, requestActor } from "@/app/_server/runtime";
import { duplicateDecidable, loadReview, REJECTION_REASON_MAX } from "@/features/review";
import { StatusPill } from "../status-pill";
import { DONE_MESSAGES, ERROR_MESSAGES, messageFor } from "./messages";
import { approveAction, confirmNotDuplicateAction, correctFieldAction, rejectAction, rejectAsDuplicateAction } from "./actions";
import { DocumentList, needsAttention, Source, STATUS_LABEL, StatusBadge } from "./review-parts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // `?field=<key>` selects a header field, `?field=<key>&item=<n>` a line-item field (#25).
  const selectedItem = query.item !== undefined && /^\d{1,4}$/.test(query.item) ? Number(query.item) : null;
  const selected =
    selectedItem === null
      ? fields.find((field) => field.key === query.field)
      : lineItems.find((item) => item.itemIndex === selectedItem)?.fields.find((field) => field.key === query.field);
  const inReview = request.status === "REVIEW";
  // Decidable before approval and not while a worker holds the request (status machine, #27).
  const canDecideDuplicate = duplicateDecidable(request);
  const done = messageFor(DONE_MESSAGES, query.done);
  const error = messageFor(ERROR_MESSAGES, query.error);
  const openItems = lineItems.reduce((count, item) => count + item.fields.filter(needsAttention).length, fields.filter(needsAttention).length);

  return (
    <main>
      <Link href="/requests" className="back">
        ← Anfragen
      </Link>
      <div className="page-head">
        <div>
          <h1>{request.subject ?? "(ohne Betreff)"}</h1>
          <p className="meta">
            Status: <StatusPill status={request.status} testId="request-status" />
            {exportRecord?.erpReference && (
              <span>
                · ERP-Referenz: <strong data-testid="erp-reference">{exportRecord.erpReference}</strong>
              </span>
            )}
            {inReview && openItems > 0 && <span>· {openItems === 1 ? "1 Wert braucht Aufmerksamkeit" : `${openItems} Werte brauchen Aufmerksamkeit`}</span>}
          </p>
        </div>
      </div>
      {done && <p role="status">{done}</p>}
      {error && <p role="alert">{error}</p>}
      {request.status === "ERROR" && request.errorMessage && <p role="alert">Fehler: {request.errorMessage}</p>}
      {request.status === "REJECTED" && request.rejectionReason && <p className="callout callout-info">Abgelehnt: {request.rejectionReason}</p>}
      {request.status === "APPROVED" && exportRecord?.lastError && (
        <p role="status" className="callout callout-warn">
          Export wird wiederholt ({exportRecord.attempts} Versuche bisher): {exportRecord.lastError}
        </p>
      )}
      {request.possibleDuplicate && request.duplicateOfId && (
        <section aria-labelledby="duplicate-heading" className="callout callout-warn" data-testid="duplicate-banner">
          <h2 id="duplicate-heading">Mögliches Duplikat</h2>
          <p>
            Gleiche E-Mail oder gleiche Dateien wie <Link href={`/requests/${request.duplicateOfId}`}>diese Anfrage</Link>.
            {request.duplicateDecision === "distinct" && " Entscheidung: eigenständige Anfrage."}
            {request.duplicateDecision === "duplicate" && " Entscheidung: als Duplikat abgelehnt."}
          </p>
          {request.duplicateDecision === null && canDecideDuplicate && (
            <div className="actions">
              <form action={confirmNotDuplicateAction}>
                <input type="hidden" name="requestId" value={request.id} />
                <button type="submit">Kein Duplikat – weiter bearbeiten</button>
              </form>
              <form action={rejectAsDuplicateAction} className="inline-form">
                <input type="hidden" name="requestId" value={request.id} />
                <label>
                  Grund <input name="reason" required maxLength={REJECTION_REASON_MAX} defaultValue="Duplikat einer bestehenden Anfrage" />
                </label>
                <button type="submit" className="btn-danger">
                  Als Duplikat ablehnen
                </button>
              </form>
            </div>
          )}
        </section>
      )}

      {fields.length > 0 && (
        <section className="card" aria-labelledby="fields-heading">
          <div className="card-head">
            <h2 id="fields-heading">Erkannte Angaben</h2>
            <p>Klick auf „Quelle anzeigen“ zeigt die Fundstelle im Original.</p>
          </div>
          <div className="table-wrap">
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
                  <tr key={field.key} className={needsAttention(field) ? "attention" : undefined}>
                    <th scope="row">{field.label}</th>
                    <td data-testid={`value-${field.key}`}>
                      {field.value ?? <span className="muted">–</span>}
                      {field.corrected && <small> (korrigiert; erkannt: {field.extractedValue ?? "–"})</small>}
                    </td>
                    <td>
                      <StatusBadge status={field.reviewStatus} />
                      {field.corrected && <small> (erkannt: {STATUS_LABEL[field.status]})</small>}
                    </td>
                    <td className="nowrap">
                      {field.source ? <Link href={`/requests/${request.id}?field=${field.key}`}>Quelle anzeigen</Link> : <span className="muted">–</span>}
                    </td>
                    {inReview && (
                      <td>
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
          {selected && selected.itemIndex === null && <Source field={selected} />}
        </section>
      )}

      {lineItems.length > 0 && (
        <section className="card" aria-labelledby="items-heading">
          <div className="card-head">
            <h2 id="items-heading">Positionen</h2>
            <p>Klick auf einen Wert zeigt die Fundstelle und erlaubt die Korrektur.</p>
          </div>
          <div className="table-wrap">
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
                        className={needsAttention(field) ? "attention value-cell" : "value-cell"}
                      >
                        <span className="item-value">
                          {/* The accessible name contains the visible value (WCAG 2.5.3 label in name). */}
                          <Link
                            href={`/requests/${request.id}?field=${field.key}&item=${item.itemIndex}`}
                            aria-label={`Position ${item.itemIndex + 1}, ${field.label}: ${field.value ?? "–"}`}
                          >
                            {field.value ?? "–"}
                          </Link>
                          <StatusBadge status={field.reviewStatus} />
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && selected.itemIndex !== null && (
            <section aria-labelledby="item-field-heading" className="panel">
              <h3 id="item-field-heading">
                Position {selected.itemIndex + 1}: {selected.label}
              </h3>
              <p>
                Wert: <strong data-testid="selected-item-value">{selected.value ?? "–"}</strong> <StatusBadge status={selected.reviewStatus} />
                {selected.corrected && <small> (erkannt: {selected.extractedValue ?? "–"}, {STATUS_LABEL[selected.status]})</small>}
              </p>
              {inReview && (
                <form action={correctFieldAction} className="inline-form">
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="field" value={selected.key} />
                  <input type="hidden" name="item" value={selected.itemIndex} />
                  <label>
                    Neuer Wert für Position {selected.itemIndex + 1}, {selected.label}
                    <input name="value" defaultValue={selected.value ?? ""} maxLength={500} />
                  </label>
                  <button type="submit">Speichern</button>
                </form>
              )}
              <Source field={selected} />
            </section>
          )}
        </section>
      )}

      {inReview && (
        <section className="card" aria-labelledby="decision-heading">
          <div className="card-head">
            <h2 id="decision-heading">Entscheidung</h2>
            <p>Nach der Freigabe wird die Anfrage genau einmal ans ERP übergeben.</p>
          </div>
          <div className="actions">
            <form action={approveAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <button type="submit" className="btn-primary">
                Freigeben
              </button>
            </form>
            <form action={rejectAction} className="inline-form">
              <input type="hidden" name="requestId" value={request.id} />
              <label>
                Grund der Ablehnung <input name="reason" required maxLength={REJECTION_REASON_MAX} />
              </label>
              <button type="submit" className="btn-danger">
                Ablehnen
              </button>
            </form>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="documents-heading">
        <h2 id="documents-heading">Dokumente</h2>
        <DocumentList documents={documents} skippedDocuments={skippedDocuments} documentNotes={documentNotes} />
      </section>
    </main>
  );
}
