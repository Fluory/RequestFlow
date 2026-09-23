import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { listExportRecords } from "@/features/export";
import { listRequests, type RequestFilter } from "@/features/requests";
import { reprocessAction } from "./actions";
import { REQUEST_STATUS_LABEL, requestStatusLabel } from "./status-labels";
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
      <h1>Anfragen</h1>
      <UploadForm />
      {done && <p role="status">{done}</p>}
      {error && <p role="alert">{error}</p>}
      <form method="get" aria-label="Filter">
        <label>
          Status{" "}
          <select name="status" defaultValue={filter.status ?? ""}>
            <option value="">alle</option>
            {Object.entries(REQUEST_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          <input type="checkbox" name="duplicate" value="1" defaultChecked={filter.possibleDuplicate === true} /> nur mögliche Duplikate
        </label>{" "}
        <button type="submit">Filtern</button>
      </form>
      {requests.length === 0 ? (
        <p>{filter.status || filter.possibleDuplicate ? "Keine Anfragen für diesen Filter." : "Noch keine Anfragen."}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Eingang</th>
              <th scope="col">Betreff</th>
              <th scope="col">Status</th>
              <th scope="col">Versuche</th>
              <th scope="col">Letzter Fehler</th>
              <th scope="col">Nächster Versuch</th>
              <th scope="col">Hinweis</th>
              <th scope="col">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => {
              const exportRecord = exports.get(request.id);
              // While the export retries, the request stays APPROVED; its cause lives on the export record.
              const exportRetrying = request.status === "APPROVED" && exportRecord?.lastError;
              const lastError = request.errorMessage ?? (exportRetrying ? exportRecord.lastError : null);
              const stage = request.errorStage ?? (exportRetrying ? "export" : null);
              const attempts = exportRetrying ? exportRecord.attempts : request.attempts;
              return (
                <tr key={request.id} data-testid={`request-${request.id}`}>
                  <td>{dateFormat.format(request.createdAt)}</td>
                  <td>
                    <Link href={`/requests/${request.id}`}>{request.subject ?? "(ohne Betreff)"}</Link>
                  </td>
                  <td>
                    {requestStatusLabel(request.status)}
                    {request.status === "ERROR" && stage ? ` (${STAGE_LABEL[stage] ?? stage})` : ""}
                  </td>
                  <td>{attempts > 0 ? attempts : "–"}</td>
                  <td>{lastError ? `${stage ? `${STAGE_LABEL[stage] ?? stage}: ` : ""}${lastError}` : "–"}</td>
                  <td>{request.nextRetryAt ? dateFormat.format(request.nextRetryAt) : "–"}</td>
                  <td>{request.possibleDuplicate ? "Mögliches Duplikat" : ""}</td>
                  <td>
                    {request.status === "ERROR" && (
                      <form action={reprocessAction}>
                        <input type="hidden" name="requestId" value={request.id} />
                        <button type="submit">Erneut verarbeiten</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
