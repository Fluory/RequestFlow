import Link from "next/link";
import { Brand } from "@/app/_components/app-header";
import { getRuntime, requestActor } from "@/app/_server/runtime";
import { countRequestsByStatus } from "@/features/requests";

export const dynamic = "force-dynamic";

// Start page (#52, design prototype A): entry tiles; the request tile shows what needs work.
export default async function HomePage() {
  const actor = await requestActor();
  if (!actor) {
    return (
      <main className="auth">
        <div className="auth-inner">
          <Brand className="auth-brand" />
          <div className="card">
            <h1>RequestFlow</h1>
            <p className="muted">Angebotsanfragen erfassen, neben der Quelle prüfen und genau einmal ans ERP übergeben.</p>
            <p>
              <Link href="/login">Anmelden</Link> · <Link href="/signup">Konto mit Einladung anlegen</Link>
            </p>
          </div>
          <p className="auth-foot">Pilot – alle Daten sind synthetisch.</p>
        </div>
      </main>
    );
  }
  // Counted in the database per status – the request list itself is paged (#48).
  const counts = await getRuntime().tenancy.withTenant(actor.companyId, (tx) => countRequestsByStatus(tx));
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const stats = total ? `${counts.REVIEW ?? 0} zur Prüfung · ${counts.ERROR ?? 0} mit Fehler · ${total} insgesamt` : "Noch keine Anfragen";
  return (
    <main>
      <h1>Start</h1>
      <nav className="tiles" aria-label="Bereiche">
        <Link href="/requests" className="tile">
          <strong>Anfragen</strong>
          <span>{stats}</span>
        </Link>
        {actor.role === "admin" && (
          <>
            <Link href="/users" className="tile">
              <strong>Benutzer verwalten</strong>
              <span>Rollen ändern, Zugänge deaktivieren</span>
            </Link>
            <Link href="/invite" className="tile">
              <strong>Mitarbeitende einladen</strong>
              <span>Einladungslink erzeugen, 7 Tage gültig</span>
            </Link>
          </>
        )}
      </nav>
    </main>
  );
}
