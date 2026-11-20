import Link from "next/link";

// Legal links on every page (Impressum, Datenschutz) – also for visitors without a session.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Rechtliches">
        <Link href="/impressum">Impressum</Link>
        <Link href="/datenschutz">Datenschutz</Link>
      </nav>
    </footer>
  );
}
