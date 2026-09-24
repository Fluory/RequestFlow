import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntime, requestActor } from "@/app/_server/runtime";
import { listExportRecords } from "@/features/export";
import { listRequests, parseCursor, type RequestFilter } from "@/features/requests";
import { reprocessAction } from "./actions";
import { requestRowView } from "./row-view";
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

// Request list (#26): status, attempts, last error with its stage, next retry; reprocess for ERROR.
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requestActor();
  if (!actor) redirect("/login");
  const query = await searchParams;
  const filter = filterOf(query);
  const after = parseCursor(query.after) ?? undefined;
  // One page (#48); export records only for the rows of this page.
  const { requests, nextCursor, firstPage, exports } = await getRuntime().tenancy.withTenant(actor.companyId, async (tx) => {
    const { rows, nextCursor, firstPage } = await listRequests(tx, filter, { after });
    return { requests: rows, nextCursor, firstPage, exports: await listExportRecords(tx, rows.map((row) => row.id)) };
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
                  <th scope="col">Betreff</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Versuche
                  </th>
                  <th scope="col">Letzter Fehler</th>
                  <th scope="col">Nächster Versuch</th>
                  <th scope="col">Duplikat</th>
                  <th scope="col">
                    <span className="visually-hidden">Aktion</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const row = requestRowView(request, exports.get(request.id));
                  const duplicate = !request.possibleDuplicate
                    ? null
                    : request.duplicateDecision === "distinct"
                      ? "als eigenständig geprüft"
                      : request.duplicateDecision === "duplicate"
                        ? "als Duplikat abgelehnt"
                        : "Entscheidung offen";
                  return (
                    <tr key={request.id} data-testid={`request-${request.id}`} className={request.status === "ERROR" ? "row-error" : undefined}>
                      <td className="mono">{dateFormat.format(request.createdAt)}</td>
                      <td className="subject">
                        <Link href={`/requests/${request.id}`}>{request.subject ?? "(ohne Betreff)"}</Link>
                      </td>
                      <td>
                        <div className="status-cell">
                          <StatusPill status={request.status} />
                          {request.status === "ERROR" && row.stage && <span className="stage">Stufe: {STAGE_LABEL[row.stage]}</span>}
                        </div>
                      </td>
                      <td className="num mono">{row.attempts > 0 ? row.attempts : "–"}</td>
                      {/* The stage appears once: in the status for ERROR, as a prefix while retrying. */}
                      <td className="error-text">{row.error ? `${request.status !== "ERROR" && row.stage ? `${STAGE_LABEL[row.stage]}: ` : ""}${row.error}` : "–"}</td>
                      <td className="mono">{row.nextRetryAt ? dateFormat.format(row.nextRetryAt) : "–"}</td>
                      <td>
                        {duplicate === "Entscheidung offen" ? (
                          <span className="pill pill-warn">Mögliches Duplikat – Entscheidung offen</span>
                        ) : (
                          (duplicate ?? <span className="muted">–</span>)
                        )}
                      </td>
                      <td className="num">
                        {request.status === "ERROR" && (
                          <form action={reprocessAction}>
                            <input type="hidden" name="requestId" value={request.id} />
                            <button type="submit" className="btn-small" aria-label={`Erneut verarbeiten: ${request.subject ?? "(ohne Betreff)"}`}>
                              Erneut verarbeiten
                            </button>
                          </form>
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
