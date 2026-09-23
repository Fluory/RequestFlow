import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentActor, getRuntime } from "@/app/_server/runtime";
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
const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeZone: "Europe/Berlin" });
const pick = (table: Record<string, string>, code: string | undefined) => (code !== undefined && Object.hasOwn(table, code) ? table[code] : undefined);

// User management for company admins (#30). Clerks get 404 – server-side, on render and in every action.
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await currentActor(await headers());
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
      <p>
        <Link href="/">← Start</Link>
      </p>
      <h1>Benutzer</h1>
      {done && <p role="status">{done}</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        <Link href="/invite">Person einladen</Link>
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">E-Mail</th>
            <th scope="col">Rolle</th>
            <th scope="col">Status</th>
            <th scope="col">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {view.users.map((user) => (
            <tr key={user.userId} data-testid={`user-${user.email}`}>
              <th scope="row">{user.name}</th>
              <td>{user.email}</td>
              <td>
                <form action={changeRoleAction}>
                  <input type="hidden" name="userId" value={user.userId} />
                  <label>
                    <span className="visually-hidden">Rolle von {user.email}</span>
                    <select name="role" defaultValue={user.role}>
                      <option value="clerk">{ROLE_LABEL.clerk}</option>
                      <option value="admin">{ROLE_LABEL.admin}</option>
                    </select>
                  </label>{" "}
                  <button type="submit">Rolle speichern</button>
                </form>
              </td>
              <td>{user.active ? "aktiv" : "deaktiviert"}</td>
              <td>
                <form action={user.active ? deactivateAction : reactivateAction}>
                  <input type="hidden" name="userId" value={user.userId} />
                  <button type="submit">{user.active ? "Deaktivieren" : "Reaktivieren"}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Offene Einladungen</h2>
      {view.invitations.length === 0 ? (
        <p>Keine offenen Einladungen.</p>
      ) : (
        <ul>
          {view.invitations.map((invitation) => (
            <li key={invitation.id}>
              {invitation.email} – {ROLE_LABEL[invitation.role] ?? invitation.role}, gültig bis {dateFormat.format(invitation.expiresAt)}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
