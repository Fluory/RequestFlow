import Link from "next/link";
import { Brand } from "@/app/_components/app-header";
import { getRuntime, requestActor } from "@/app/_server/runtime";
import { countRequestsByStatus, findSampleForVisitors } from "@/features/requests";

export const dynamic = "force-dynamic";

// Start page (#52, design prototype A): entry tiles; the request tile shows what needs work. #77: a
// "next step" leads to the open work, or – when there is none – to the prepared sample (#71).
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
            {/* #75: visitors without an account find the public case study here. */}
            <p>
              <Link href="/case-study">So funktioniert RequestFlow – Fallstudie lesen</Link>
            </p>
          </div>
          <p className="auth-foot">Pilot – alle Daten sind synthetisch.</p>
        </div>
      </main>
    );
  }
  // Counted in the database per status – the request list itself is paged (#48).
  const { counts, sample } = await getRuntime().tenancy.withTenant(actor.companyId, async (tx) => ({
    counts: await countRequestsByStatus(tx),
    sample: await findSampleForVisitors(tx),
  }));
  const inReview = counts.REVIEW ?? 0;
  const failed = counts.ERROR ?? 0;
  const next = inReview
    ? { href: "/requests?status=REVIEW", label: inReview === 1 ? "1 Anfrage wartet auf Ihre Prüfung" : `${inReview} Anfragen warten auf Ihre Prüfung`, action: "Jetzt prüfen" }
    : failed
      ? { href: "/requests?status=ERROR", label: failed === 1 ? "1 Anfrage ist fehlgeschlagen" : `${failed} Anfragen sind fehlgeschlagen`, action: "Fehler ansehen" }
      : sample
        ? { href: `/requests/${sample.id}`, label: "Nichts wartet auf Ihre Prüfung – sehen Sie sich den vorbereiteten Musterfall an", action: "Musterfall öffnen" }
        : null;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const stats = total ? `${counts.REVIEW ?? 0} zur Prüfung · ${counts.ERROR ?? 0} mit Fehler · ${total} insgesamt` : "Noch keine Anfragen";
  return (
    <main>
      <h1>Start</h1>
      {next && (
        <section className="card card-pad next-step" aria-labelledby="next-step-heading" data-testid="next-step">
          <h2 id="next-step-heading">Nächster Schritt</h2>
          <p>{next.label}</p>
          <Link href={next.href} className="btn-link">
            {next.action}
          </Link>
        </section>
      )}
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
