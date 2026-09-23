import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { listExportRecords } from "@/features/export";
import { listRequests, type RequestFilter } from "@/features/requests";
import { reprocessAction } from "./actions";
import { requestRowView } from "./row-view";
import { REQUEST_STATUS_LABEL } from "./status-labels";
import { StatusPill } from "./status-pill";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" });
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

// Request list (#26): status, attempts, last error with its stage, next retry; reprocess for ERROR.
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  const query = await searchParams;
  const filter = filterOf(query);
  const { requests, exports } = await getRuntime().tenancy.withTenant(actor.companyId, async (tx) => {
    const rows = await listRequests(tx, filter);
    return { requests: rows, exports: await listExportRecords(tx, rows.map((row) => row.id)) };
  });
  const done = query.done === "reprocessed" ? pick("reprocessed") : undefined;
  const error = query.error === "refused" ? pick("refused") : undefined;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Anfragen</h1>
          <p className="lead">Neue Anfrage als E-Mail oder Dateien hochladen – sie wird automatisch ausgelesen und erscheint danach zur Prüfung.</p>
        </div>
      </div>
      <section className="card" aria-label="Anfrage hochladen">
        <UploadForm />
      </section>
      {done && <p role="status">{done}</p>}
      {error && <p role="alert">{error}</p>}
      <section className="card card-flush" aria-label="Anfragenliste">
        <form method="get" aria-label="Filter" className="toolbar">
          <label>
            Status
            <select name="status" defaultValue={filter.status ?? ""}>
              <option value="">alle</option>
              {Object.entries(REQUEST_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" name="duplicate" value="1" defaultChecked={filter.possibleDuplicate === true} /> nur mögliche Duplikate
          </label>
          <button type="submit" className="btn-small">
            Filtern
          </button>
          <span className="muted hint">{requests.length === 1 ? "1 Anfrage" : `${requests.length} Anfragen`}</span>
        </form>
        {requests.length === 0 ? (
          <p className="empty">{filter.status || filter.possibleDuplicate ? "Keine Anfragen für diesen Filter." : "Noch keine Anfragen."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Eingang</th>
                  <th scope="col" className="subject">
                    Betreff
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Versuche
                  </th>
                  <th scope="col">Letzter Fehler</th>
                  <th scope="col">Nächster Versuch</th>
                  <th scope="col">Hinweis</th>
                  <th scope="col">
                    <span className="visually-hidden">Aktion</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const row = requestRowView(request, exports.get(request.id));
                  return (
                    <tr key={request.id} data-testid={`request-${request.id}`}>
                      <td className="nowrap muted">{dateFormat.format(request.createdAt)}</td>
                      <td className="subject">
                        <Link href={`/requests/${request.id}`}>{request.subject ?? "(ohne Betreff)"}</Link>
                      </td>
                      <td>
                        <StatusPill status={request.status} />
                        {request.status === "ERROR" && row.stage && <span className="stage">{STAGE_LABEL[row.stage]}</span>}
                      </td>
                      <td className="num">{row.attempts > 0 ? row.attempts : "–"}</td>
                      {/* The stage appears once: in the status for ERROR, as a prefix while retrying. */}
                      <td>{row.error ? `${request.status !== "ERROR" && row.stage ? `${STAGE_LABEL[row.stage]}: ` : ""}${row.error}` : "–"}</td>
                      <td className="nowrap">{row.nextRetryAt ? dateFormat.format(row.nextRetryAt) : "–"}</td>
                      <td className="hint">
                        {request.possibleDuplicate ? (
                          request.duplicateDecision === "distinct" ? (
                            "Duplikat geprüft: eigenständig"
                          ) : request.duplicateDecision === "duplicate" ? (
                            "Als Duplikat abgelehnt"
                          ) : (
                            <span className="badge badge-uncertain">⚠ Mögliches Duplikat – Entscheidung offen</span>
                          )
                        ) : (
                          ""
                        )}
                      </td>
                      <td>
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
      </section>
    </main>
  );
}
