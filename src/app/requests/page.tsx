import Link from "next/link";
import { redirect } from "next/navigation";
import { drainOnPageView } from "@/app/_server/drain";
import { getRuntime, requestActor } from "@/app/_server/runtime";
import { listExportRecords } from "@/features/export";
import { listRequests, parseCursor, type RequestFilter } from "@/features/requests";
import { listReviewSummaries } from "@/features/review";
import { reprocessAction } from "./actions";
import { nextAction, requestRowView } from "./row-view";
import { SAMPLE_LABEL } from "./sample-label";
import { REQUEST_STATUS_LABEL } from "./status-labels";
import { StatusPill } from "./status-pill";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";
// Server actions of this page may drain inline via `after()` (JOB_DRAIN_INLINE) – SERVERLESS_DRAIN limit.
export const maxDuration = 300;

const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const STAGE_LABEL: Record<string, string> = { processing: "Verarbeitung", export: "Export" };
const MESSAGES: Record<string, string> = {
  reprocessed: "Erneut eingeplant.",
  refused: "Diese Anfrage kann nicht erneut verarbeitet werden.",
};
const pick = (code: string | undefined) => (code !== undefined && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined);

/** Filters come from the query string; unknown values are ignored (never passed through). */
function filterOf(query: Record<string, string | undefined>): RequestFilter {
  const status = query.status && Object.hasOwn(REQUEST_STATUS_LABEL, query.status) ? (query.status as RequestFilter["status"]) : undefined;
  const possibleDuplicate = query.duplicate === "1" ? true : undefined;
  return { status, possibleDuplicate };
}

/** Link to a page of the list with the current filters (paging never drops them, #48). */
function pageHref(filter: RequestFilter, after?: string): string {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.possibleDuplicate) params.set("duplicate", "1");
  if (after) params.set("after", after);
  const query = params.toString();
  return query ? `/requests?${query}` : "/requests";
}

// Request list (#26, #77): leads with customer, need for review and the next action; attempts, last error
// with its stage and next retry sit in an expandable diagnosis per row; reprocess for ERROR.
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requestActor();
  if (!actor) redirect("/login");
  drainOnPageView();
  const query = await searchParams;
  const filter = filterOf(query);
  const after = parseCursor(query.after) ?? undefined;
  // One page (#48); export records and review summaries only for the rows of this page.
  const { requests, nextCursor, firstPage, exports, summaries } = await getRuntime().tenancy.withTenant(actor.companyId, async (tx) => {
    const { rows, nextCursor, firstPage } = await listRequests(tx, filter, { after });
    const ids = rows.map((row) => row.id);
    return { requests: rows, nextCursor, firstPage, exports: await listExportRecords(tx, ids), summaries: await listReviewSummaries(tx, ids) };
  });
  const paged = !firstPage || nextCursor !== null;
  const done = query.done === "reprocessed" ? pick("reprocessed") : undefined;
  const error = query.error === "refused" ? pick("refused") : undefined;

  return (
    <main>
      <h1>Anfragen</h1>
      {done && <p role="status">{done}</p>}
      {error && <p role="alert">{error}</p>}
      <section className="card card-pad" aria-label="Anfrage hochladen">
        <UploadForm />
      </section>
      <section className="card" aria-label="Anfragenliste">
        <form method="get" aria-label="Filter" className="toolbar">
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={filter.status ?? ""}>
              <option value="">alle</option>
              {Object.entries(REQUEST_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" name="duplicate" value="1" defaultChecked={filter.possibleDuplicate === true} />
            nur mögliche Duplikate
          </label>
          <button type="submit">Filtern</button>
          <span className="count">
            {requests.length === 1 ? "1 Anfrage" : `${requests.length} Anfragen`}
            {paged && " auf dieser Seite"}
          </span>
        </form>
        {requests.length === 0 ? (
          <p className="empty">
            {filter.status || filter.possibleDuplicate ? "Keine Anfragen für diesen Filter." : "Noch keine Anfragen. Laden Sie oben eine E-Mail oder Dateien hoch."}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="requests-table">
              <thead>
                <tr>
                  <th scope="col">Eingang</th>
                  <th scope="col">Kunde und Betreff</th>
                  <th scope="col">Prüfbedarf</th>
                  <th scope="col">Nächste Aktion</th>
                  <th scope="col">Status</th>
                  <th scope="col">Diagnose</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const exportRecord = exports.get(request.id);
                  const row = requestRowView(request, exportRecord);
                  const action = nextAction(request, exportRecord);
                  const summary = summaries.get(request.id);
                  const subject = request.subject ?? "(ohne Betreff)";
                  const inReview = request.status === "REVIEW";
                  const duplicate = !request.possibleDuplicate
                    ? null
                    : request.duplicateDecision === "distinct"
                      ? "Mögliches Duplikat – als eigenständig geprüft"
                      : request.duplicateDecision === "duplicate"
                        ? "Mögliches Duplikat – als Duplikat abgelehnt"
                        : "Mögliches Duplikat – Entscheidung offen";
                  const hasDiagnosis = row.attempts > 0 || row.error !== null || row.nextRetryAt !== null || duplicate !== null;
                  // A sample in ERROR from processing is not reprocessed: that would call the live model (#71).
                  const canReprocess = request.status === "ERROR" && !(request.source === "sample" && request.errorStage === "processing");
                  return (
                    <tr key={request.id} data-testid={`request-${request.id}`} className={request.status === "ERROR" ? "row-error" : undefined}>
                      <td className="mono">{dateFormat.format(request.createdAt)}</td>
                      <td className="subject">
                        <span className="customer" data-testid="request-customer">
                          {summary?.company ?? <span className="muted">Kunde noch nicht erkannt</span>}
                        </span>
                        <Link href={`/requests/${request.id}`}>{subject}</Link>
                        {request.source === "sample" && (
                          <>
                            {" "}
                            <span className="pill pill-info" data-testid="sample-label">
                              {SAMPLE_LABEL}
                            </span>
                          </>
                        )}
                      </td>
                      <td data-testid="request-attention">
                        {inReview && summary ? (
                          <div className="attention-cell">
                            {summary.attention > 0 ? (
                              <span className="pill pill-warn">⚠ {summary.attention === 1 ? "1 Wert prüfen" : `${summary.attention} Werte prüfen`}</span>
                            ) : (
                              <span className="pill pill-success">alles belegt</span>
                            )}
                            {summary.missing > 0 && <span className="muted">{summary.missing === 1 ? "1 Angabe fehlt" : `${summary.missing} Angaben fehlen`}</span>}
                          </div>
                        ) : (
                          <span className="muted">–</span>
                        )}
                      </td>
                      <td data-testid="request-next-action">
                        {action === null ? (
                          <span className="muted">–</span>
                        ) : action.kind === "todo" ? (
                          <div className="action-cell">
                            <Link href={`/requests/${request.id}`} className="next-action" aria-label={`${action.label}: ${subject}`}>
                              {action.label}
                            </Link>
                            {canReprocess && (
                              <form action={reprocessAction}>
                                <input type="hidden" name="requestId" value={request.id} />
                                <button type="submit" className="btn-small" aria-label={`Erneut verarbeiten: ${subject}`}>
                                  Erneut verarbeiten
                                </button>
                              </form>
                            )}
                          </div>
                        ) : (
                          <span className="waiting">{action.label}</span>
                        )}
                      </td>
                      <td>
                        <div className="status-cell">
                          <StatusPill status={request.status} />
                          {request.status === "ERROR" && row.stage && <span className="stage">Stufe: {STAGE_LABEL[row.stage]}</span>}
                        </div>
                      </td>
                      <td>
                        {hasDiagnosis ? (
                          <details className="diagnosis">
                            <summary>Details</summary>
                            <dl>
                              {row.attempts > 0 && (
                                <>
                                  <dt>Versuche</dt>
                                  <dd className="mono">{row.attempts}</dd>
                                </>
                              )}
                              {row.error && (
                                <>
                                  {/* The stage appears once: in the status for ERROR, as a prefix while retrying. */}
                                  <dt>Letzter Fehler</dt>
                                  <dd>{`${request.status !== "ERROR" && row.stage ? `${STAGE_LABEL[row.stage]}: ` : ""}${row.error}`}</dd>
                                </>
                              )}
                              {row.nextRetryAt && (
                                <>
                                  <dt>Nächster Versuch</dt>
                                  <dd className="mono">{dateFormat.format(row.nextRetryAt)}</dd>
                                </>
                              )}
                              {duplicate && (
                                <>
                                  <dt>Duplikat</dt>
                                  <dd>{duplicate}</dd>
                                </>
                              )}
                            </dl>
                          </details>
                        ) : (
                          <span className="muted">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {paged && (
          <nav aria-label="Seiten" className="toolbar">
            {!firstPage && <Link href={pageHref(filter)}>Zurück zum Anfang</Link>}
            {nextCursor && <Link href={pageHref(filter, nextCursor)} rel="next">Ältere Anfragen</Link>}
          </nav>
        )}
      </section>
    </main>
  );
}
