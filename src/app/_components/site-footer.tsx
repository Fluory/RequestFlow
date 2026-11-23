import Link from "next/link";
import { OPERATOR, PORTFOLIO_URL } from "./operator";

// Legal links on every page (Impressum, Datenschutz) – also for visitors without a session – and the
// portfolio notice: who built this reference project and that everything shown is synthetic.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Rechtliches">
        <Link href="/impressum">Impressum</Link>
        <Link href="/datenschutz">Datenschutz</Link>
      </nav>
      <p className="site-footer-note">
        <a href={PORTFOLIO_URL}>Portfolio-Projekt von {OPERATOR.name}</a> · Referenzprojekt, gebaut wie ein echter
        Kundenauftrag · Kunde fiktiv, alle Daten synthetisch · kein Produkt zum Kauf
      </p>
    </footer>
  );
}
