import type { Metadata } from "next";
import { OPERATOR, operatorAddress } from "@/app/_components/operator";

// Public, static: no session lookup and no data access (like /case-study).
export const metadata: Metadata = { title: "Impressum – RequestFlow" };

export default function ImpressumPage() {
  return (
    <main className="case-study legal-page">
      <h1>Impressum</h1>

      <section className="cs-section">
        <h2>Angaben gemäß § 5 DDG</h2>
        <p className="legal-lines">
          {operatorAddress().map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      </section>

      <section className="cs-section">
        <h2>Kontakt</h2>
        <p className="legal-lines">
          <span>
            E-Mail: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
          </span>
          {OPERATOR.phone && <span>Telefon: {OPERATOR.phone}</span>}
        </p>
      </section>

      <section className="cs-section">
        <h2>Umsatzsteuer</h2>
        <p>
          {OPERATOR.smallBusiness
            ? "Als Kleinunternehmer im Sinne des § 19 UStG wird keine Umsatzsteuer berechnet und in Rechnungen nicht ausgewiesen."
            : `Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: ${OPERATOR.vatId}`}
        </p>
      </section>

      <section className="cs-section">
        <h2>Verantwortlich für den Inhalt nach § 18 Abs.&nbsp;2 MStV</h2>
        <p>{OPERATOR.name}, Anschrift wie oben.</p>
      </section>

      <section className="cs-section">
        <h2>Über diese Anwendung</h2>
        <p>
          RequestFlow ist ein Referenzprojekt und eine Vorführung. Alle gezeigten Firmen, Personen, Anfragen und Dokumente sind
          erfunden (synthetische Daten). Der Gastzugang legt eine eigene Demo-Firma mit vorbereiteten Beispielen an; sie wird nach
          Ablauf der Aufbewahrungsfrist vollständig gelöscht (siehe <a href="/datenschutz">Datenschutzerklärung</a>).
        </p>
      </section>

      <section className="cs-section">
        <h2>Haftung für Inhalte</h2>
        <p>
          Als Diensteanbieter bin ich gemäß § 7 Abs.&nbsp;1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen
          verantwortlich. Nach §§ 8 bis 10 DDG bin ich jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen
          zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen. Verpflichtungen zur Entfernung
          oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt.
        </p>
      </section>

      <section className="cs-section">
        <h2>Haftung für Links</h2>
        <p>
          Diese Anwendung enthält Links zu externen Websites Dritter (z.&nbsp;B. GitHub), auf deren Inhalte ich keinen Einfluss habe. Für
          diese fremden Inhalte kann ich daher keine Gewähr übernehmen; verantwortlich ist stets der jeweilige Anbieter oder Betreiber.
          Bei Bekanntwerden von Rechtsverletzungen entferne ich derartige Links umgehend.
        </p>
      </section>

      <section className="cs-section">
        <h2>Urheberrecht</h2>
        <p>
          Die von mir erstellten Inhalte, Grafiken und Programme auf diesen Seiten unterliegen dem deutschen Urheberrecht.
          Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechts bedürfen meiner
          schriftlichen Zustimmung.
        </p>
      </section>

      <section className="cs-section">
        <h2>Verbraucherstreitbeilegung</h2>
        <p>Ich bin nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
      </section>

      <p className="cs-foot">Stand: {OPERATOR.updated}</p>
    </main>
  );
}
