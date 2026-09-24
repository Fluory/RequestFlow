import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRuntime, requestActor } from "@/app/_server/runtime";
import { AuthorizationError, listCompanyUsers } from "@/features/identity";
import { changeRoleAction, deactivateAction, reactivateAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { admin: "Administration", clerk: "Sachbearbeitung" };
const DONE: Record<string, string> = {
  role_changed: "Rolle geändert.",
  deactivated: "Zugang deaktiviert – alle Sitzungen wurden beendet.",
  reactivated: "Zugang wieder aktiviert.",
};
const ERRORS: Record<string, string> = {
  last_admin: "Der letzte aktive Admin der Firma kann weder herabgestuft noch deaktiviert werden.",
  unknown_user: "Diese Person gehört nicht zu Ihrer Firma.",
  input: "Bitte eine gültige Rolle wählen.",
  self: "Den eigenen Zugang können Sie nicht deaktivieren – das muss ein anderer Admin tun.",
};
const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
const pick = (table: Record<string, string>, code: string | undefined) => (code !== undefined && Object.hasOwn(table, code) ? table[code] : undefined);

// User management for company admins (#30). Clerks get 404 – server-side, on render and in every action.
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requestActor();
  if (!actor) redirect("/login");
  let view: Awaited<ReturnType<typeof listCompanyUsers>>;
  try {
    view = await listCompanyUsers(getRuntime().database.db, actor);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  const query = await searchParams;
  const done = pick(DONE, query.done);
  const error = pick(ERRORS, query.error);

  return (
    <main>
      <div className="page-head">
        <h1>Benutzer</h1>
        <Link href="/invite" className="btn-link">
          Person einladen
        </Link>
      </div>
      {done && <p role="status">{done}</p>}
      {error && <p role="alert">{error}</p>}
      <section className="card" aria-label="Benutzerliste">
        <div className="table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">E-Mail</th>
                <th scope="col">Status</th>
                <th scope="col">Rolle</th>
                <th scope="col" className="num">
                  Zugang
                </th>
              </tr>
            </thead>
            <tbody>
              {view.users.map((user) => (
                <tr key={user.userId} data-testid={`user-${user.email}`}>
                  <th scope="row">
                    {user.name}
                    {user.userId === actor.userId && <span className="muted"> (Sie)</span>}
                  </th>
                  <td className="muted">{user.email}</td>
                  <td>
                    <span className={user.active ? "pill pill-success" : "pill pill-neutral"}>{user.active ? "aktiv" : "deaktiviert"}</span>
                  </td>
                  <td>
                    <form action={changeRoleAction} className="inline-form">
                      <input type="hidden" name="userId" value={user.userId} />
                      <label>
                        <span className="visually-hidden">Rolle von {user.email}</span>
                        <select name="role" defaultValue={user.role}>
                          <option value="clerk">{ROLE_LABEL.clerk}</option>
                          <option value="admin">{ROLE_LABEL.admin}</option>
                        </select>
                      </label>
                      <button type="submit" className="btn-small">
                        Rolle speichern
                      </button>
                    </form>
                  </td>
                  <td className="num">
                    <form action={user.active ? deactivateAction : reactivateAction}>
                      <input type="hidden" name="userId" value={user.userId} />
                      <button type="submit" className={user.active ? "btn-danger btn-small" : "btn-small"}>
                        {user.active ? "Deaktivieren" : "Reaktivieren"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card-note">Der letzte aktive Admin kann nicht herabgestuft oder deaktiviert werden. Niemand kann sich selbst deaktivieren.</p>
      </section>
      <section className="card" aria-labelledby="invitations-heading">
        <h2 id="invitations-heading" className="card-title">
          Offene Einladungen
        </h2>
        {view.invitations.length === 0 ? (
          <p className="card-note">Keine offenen Einladungen.</p>
        ) : (
          view.invitations.map((invitation) => (
            <div key={invitation.id} className="invite-row">
              <span>{invitation.email}</span>
              <span className="muted">{ROLE_LABEL[invitation.role] ?? invitation.role}</span>
              <span className="muted">
                gültig bis <span className="mono">{dateFormat.format(invitation.expiresAt)}</span>
              </span>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
