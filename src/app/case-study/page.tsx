import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/app/_components/app-header";

// #75: public case study – static content only. No session lookup and no data access in this page; the
// auth checks of every other route stay where they are. Screenshots show the prepared samples (#71),
// synthetic data only.
export const metadata: Metadata = {
  title: "Fallstudie – RequestFlow",
  description: "Angebotsanfragen erfassen, jeden Wert neben seiner Quelle prüfen und genau einmal ans ERP übergeben – Referenzprojekt mit synthetischen Daten.",
};

const REPO = "https://github.com/Fluory/RequestFlow";
const EVIDENCE = `${REPO}/blob/main/docs/product/evidence.md`;
const ADR = `${REPO}/blob/main/docs/decisions/ADR-0001-pilot-architecture.md`;
const PROPOSAL = `${REPO}/blob/main/docs/product/pilot-vorschlag.md`;

const STEPS = [
  {
    title: "Hochladen",
    text: "Die E-Mail mit ihren Anhängen (PDF, Excel, Word) wird hochgeladen. Eine doppelt eingereichte Anfrage wird erkannt, markiert und mit dem Original verknüpft – nie stillschweigend verworfen.",
  },
  {
    title: "Erkennen mit Quelle",
    text: "Ein KI-Dienst ohne Zugriff auf Datenbank und Ablage schlägt die Werte vor, jeden mit einem wörtlichen Zitat. Ein Prüfprogramm zählt einen Wert nur als „gefunden“, wenn es das Zitat an der genannten Stelle wiederfindet.",
  },
  {
    title: "Prüfen und freigeben",
    text: "Eine Person sieht jeden Wert neben seiner Quelle, korrigiert, was unsicher ist oder fehlt, und gibt die Anfrage frei.",
  },
  {
    title: "Genau einmal ins ERP",
    text: "Idempotenzschlüssel, eindeutige Export-Zeile und Zeilensperre verhindern, dass eine Anfrage zweimal ankommt – auch wenn eine Übergabe nach einem Fehler wiederholt wird.",
  },
] as const;

const SHOTS = [
  {
    src: "/case-study/requests.png",
    alt: "Anfrageliste mit zwei vorbereiteten Musterfällen: einer wartet auf Prüfung, einer ist exportiert",
    caption: "Die Anfrageliste nennt je Anfrage den Kunden, was zu prüfen ist und den nächsten Schritt. Musterfälle sind als Beispiel gekennzeichnet.",
  },
  {
    src: "/case-study/review.png",
    alt: "Prüfansicht des Musterfalls „Werk Ost“: erkannte Angaben mit Status, daneben die Quelle mit markiertem Zitat",
    caption: "Prüfansicht „Werk Ost“: Der Liefertermin steht nur als Kalenderwoche in der Mail und ist deshalb „unsicher“ – die Person sieht die markierte Stelle und entscheidet.",
  },
  {
    src: "/case-study/exported.png",
    alt: "Exportierter Musterfall „Pumpe P204“ mit ERP-Referenz",
    caption: "Musterfall „Pumpe P204“: freigegeben und genau einmal an das ERP übergeben, mit der Referenz, die das ERP zurückgemeldet hat.",
  },
] as const;

export default function CaseStudyPage() {
  return (
    <main className="case-study">
      <header className="cs-hero">
        <Brand className="cs-brand" />
        <p className="cs-eyebrow">Fallstudie · Referenzprojekt</p>
        <h1>Angebotsanfragen erfassen, jeden Wert neben seiner Quelle prüfen – und genau einmal ans ERP übergeben</h1>
        <p className="cs-lede">
          RequestFlow liest Anfragen aus E-Mails und ihren PDF-, Excel- und Word-Anhängen, legt jeden erkannten Wert
          neben die Stelle im Dokument, aus der er stammt, und übergibt eine freigegebene Anfrage genau einmal an das
          ERP. Gebaut wie ein echtes Kundenprojekt für einen mittelständischen Maschinenbauer: Der Kunde ist fiktiv,
          alle Daten sind synthetisch.
        </p>
        <div className="cs-actions">
          <Link href="/login" className="btn-link">
            Live-App öffnen
          </Link>
          <a href={EVIDENCE}>Gemessene Nachweise</a>
          <a href={REPO}>Quellcode auf GitHub</a>
        </div>
        <p className="cs-note">
          Die Live-App ist auf Einladung zugänglich. Nach der Anmeldung führt der Hinweis „Nächster Schritt“ auf der
          Startseite direkt zum vorbereiteten Musterfall.
        </p>
      </header>

      <section className="cs-section" aria-labelledby="problem-heading">
        <h2 id="problem-heading">Das Problem</h2>
        <p>
          Im Vertriebsinnendienst eines Maschinenbauers kommen Angebotsanfragen als E-Mail mit Anhängen: Zeichnungen
          und Stücklisten als PDF, Positionslisten in Excel, Anschreiben in Word. Jemand überträgt Firma,
          Ansprechpartner, gewünschten Liefertermin und jede Position mit Menge, Werkstoff und Maßen von Hand ins
          ERP. Das kostet Zeit, Tippfehler fallen spät auf, und eine doppelt erfasste Anfrage erzeugt doppelte
          Vorgänge.
        </p>
        <p>
          <strong>Für wen:</strong> die Sachbearbeitung, die Anfragen erfasst und prüft, und die Teamleitung, die sehen
          will, was auf Prüfung wartet.
        </p>
      </section>

      <section className="cs-section cs-split" aria-label="Aufgabenteilung">
        <div>
          <h2>Was die KI macht</h2>
          <ul>
            <li>Sie schlägt Kopfdaten (Firma, Ansprechpartner, E-Mail, Telefon, Liefertermin, Zusatzanforderungen) und Positionen (Beschreibung, Menge, Einheit, Werkstoff, Maße) vor.</li>
            <li>Zu jedem Wert liefert sie ein wörtliches Zitat und die Stelle im Dokument.</li>
            <li>Nur wenn das Prüfprogramm das Zitat an dieser Stelle wiederfindet, gilt der Wert als „gefunden“. Alles andere ist „unsicher“ oder „fehlt“ und geht an eine Person.</li>
          </ul>
        </div>
        <div>
          <h2>Was die Person entscheidet</h2>
          <ul>
            <li>Sie sieht jeden Wert neben seiner Quelle; die zitierte Stelle ist markiert.</li>
            <li>Sie korrigiert unsichere oder fehlende Angaben; die ursprüngliche Erkennung bleibt sichtbar.</li>
            <li>Sie gibt die Anfrage frei. Ohne Freigabe geht nichts ans ERP.</li>
          </ul>
        </div>
      </section>

      <section className="cs-section" aria-labelledby="flow-heading">
        <h2 id="flow-heading">Der Ablauf</h2>
        <ol className="cs-steps">
          {STEPS.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="cs-section" aria-labelledby="sample-heading">
        <h2 id="sample-heading">Der Musterfall im Bild</h2>
        <p className="cs-synthetic">Synthetische Daten: vorbereitete Musterfälle mit einer einmal aufgezeichneten KI-Antwort.</p>
        <div className="cs-shots">
          {SHOTS.map((shot) => (
            <figure key={shot.src}>
              <Image src={shot.src} alt={shot.alt} width={1280} height={800} sizes="(max-width: 960px) 100vw, 920px" />
              <figcaption>{shot.caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="cs-section" aria-labelledby="limits-heading">
        <h2 id="limits-heading">Was geprüft ist – und was nicht</h2>
        <ul>
          <li>Das Prüfprogramm belegt, woher ein Wert stammt, nicht, ob er fachlich so gemeint ist. Deshalb prüft eine Person jeden Wert mit seinem Zitat.</li>
          <li>Zitiert ein Modell einen eingeschleusten Satz wörtlich, besteht er die Prüfung. Auch hier ist die Person die zweite Schicht.</li>
          <li>Die Qualitätszahlen stammen aus 15 synthetischen Testfällen mit vorbereiteten Modellantworten: Sie messen die Prüfkette, nicht ein Live-Modell.</li>
          <li>Die Musterfälle wurden einmal mit einem kostenlosen Modell aufgezeichnet, ausschließlich mit synthetischen Daten. Das ERP ist eine Simulation.</li>
          <li>Eine Zeitersparnis ist noch nicht gemessen und wird deshalb nicht behauptet.</li>
        </ul>
      </section>

      <section className="cs-section" aria-labelledby="more-heading">
        <h2 id="more-heading">Nachweise und Entscheidungen</h2>
        <ul className="cs-links">
          <li>
            <a href={EVIDENCE}>Gemessene Nachweise</a> – Genauigkeit je Feld, Stand der Musterfälle, Grenzen
          </li>
          <li>
            <a href={ADR}>Architekturentscheidung ADR-0001</a> – elf Entscheidungen mit verworfenen Alternativen
          </li>
          <li>
            <a href={PROPOSAL}>Pilotvorschlag an den (fiktiven) Kunden</a>
          </li>
          <li>
            <a href={REPO}>Quellcode und Tests</a> – TypeScript-Monolith (Next.js, PostgreSQL mit erzwungener
            Row-Level-Security, pg-boss) und zustandsloser Python-KI-Dienst (FastAPI, docling)
          </li>
        </ul>
        <p>
          <Link href="/login" className="btn-link">
            Live-App öffnen
          </Link>
        </p>
      </section>

      <p className="cs-foot">Referenzprojekt · Kunde fiktiv · alle Daten synthetisch</p>
    </main>
  );
}
