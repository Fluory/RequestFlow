import Link from "next/link";
import { requestActor } from "@/app/_server/runtime";

export const dynamic = "force-dynamic";

// Start page: company, role and sign-out live in the app header (#52); this page points to the work.
export default async function HomePage() {
  const actor = await requestActor();
  if (!actor) {
    return (
      <main>
        <div className="auth card">
          <h1>RequestFlow</h1>
          <p className="lead">Angebotsanfragen erfassen, neben der Quelle prüfen und genau einmal ans ERP übergeben.</p>
          <p>
            <Link href="/login">Anmelden</Link> · <Link href="/signup">Konto mit Einladung anlegen</Link>
          </p>
          <p className="muted">Pilot – alle Daten sind synthetisch.</p>
        </div>
      </main>
    );
  }
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Willkommen</h1>
          <p className="lead">Angebotsanfragen hochladen, neben der Quelle prüfen und genau einmal ans ERP übergeben.</p>
        </div>
      </div>
      <nav className="tiles" aria-label="Bereiche">
        <Link href="/requests" className="tile">
          <strong>Anfragen</strong>
          <span>Hochladen, prüfen, korrigieren und freigeben</span>
        </Link>
        {actor.role === "admin" && (
          <>
            <Link href="/users" className="tile">
              <strong>Benutzer verwalten</strong>
              <span>Rollen ändern, Zugänge deaktivieren</span>
            </Link>
            <Link href="/invite" className="tile">
              <strong>Mitarbeitende einladen</strong>
              <span>Einladungslink für neue Kolleg:innen erzeugen</span>
            </Link>
          </>
        )}
      </nav>
    </main>
  );
}
