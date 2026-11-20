import type { Metadata } from "next";
import { OPERATOR, operatorAddress } from "@/app/_components/operator";
import { getRuntime } from "@/app/_server/runtime";

// Public: no session lookup and no data access. The text follows what the code and the deployment
// configuration do (docs/technical/architecture.md "External services", deployment-vercel.md, data-model.md);
// change it together with them.
export const metadata: Metadata = { title: "Datenschutz – RequestFlow" };

/** Retention of guest companies (GUEST_RETENTION_HOURS); the configured default when the configuration is unavailable. */
function guestRetentionHours(): number {
  try {
    return getRuntime().config.guests.retentionHours;
  } catch {
    return 24;
  }
}

export default function DatenschutzPage() {
  const hours = guestRetentionHours();
  return (
    <main className="case-study legal-page">
      <h1>Datenschutzerklärung</h1>
      <p className="cs-lede">
        RequestFlow ist ein Referenzprojekt und eine Vorführung mit erfundenen (synthetischen) Daten. Bitte geben Sie hier keine echten
        personenbezogenen Daten ein und laden Sie keine echten Dokumente hoch. Hier steht, welche Daten beim Benutzen trotzdem anfallen,
        wo sie liegen und wann sie gelöscht werden.
      </p>

      <section className="cs-section">
        <h2>1. Verantwortlicher</h2>
        <p className="legal-lines">
          {operatorAddress().map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span>
            E-Mail: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
          </span>
        </p>
      </section>

      <section className="cs-section">
        <h2>2. Hosting und Server-Logfiles</h2>
        <p>
          Die Anwendung wird bei Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA, betrieben; die Server-Funktionen laufen in
          der Region Frankfurt (fra1), ausgeliefert wird über das weltweite Netzwerk von Vercel. Beim Aufruf verarbeitet Vercel technisch
          notwendige Zugriffsdaten: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Referrer, Browser und Betriebssystem.
        </p>
        <p>
          Die Anwendung selbst schreibt in ihre Protokolle nur technische Kennungen (z.&nbsp;B. die Nummer einer Anfrage) und Fehlercodes –
          keine Namen, E-Mail-Adressen oder Dokumentinhalte.
        </p>
      </section>

      <section className="cs-section">
        <h2>3. Datenbank und Dateiablage</h2>
        <p>
          Datenbank und Dateiablage liegen bei Supabase in der Region eu-central-1 (Frankfurt). Gespeichert werden:
        </p>
        <ul>
          <li>Konten: Name, E-Mail-Adresse, Passwort (nur als Hash), Rolle und Firma.</li>
          <li>Anmeldungen (Sessions): ein zufälliges Sitzungs-Token, Ablaufzeit, IP-Adresse und Browserkennung (User-Agent).</li>
          <li>Schutz vor Missbrauch: Zähler für Aufrufe der Anmeldefunktionen je IP-Adresse (kurzes Zeitfenster).</li>
          <li>
            Fachliche Daten der Firma: hochgeladene E-Mails mit Anhängen, die daraus erkannten Werte mit ihren Fundstellen, Korrekturen,
            Freigaben, Exporte und ein Protokoll, wer was wann geändert hat.
          </li>
        </ul>
        <p>
          Jede Firma sieht nur ihre eigenen Daten; das erzwingt die Datenbank selbst. Konten gibt es nur auf Einladung.
        </p>
      </section>

      <section className="cs-section">
        <h2>4. Gastzugang „Ohne Anmeldung ausprobieren“</h2>
        <p>
          Ein Klick legt eine eigene Demo-Firma mit vorbereiteten, erfundenen Beispielen an und meldet Sie mit einem zufällig erzeugten
          Gastkonto an – Name oder E-Mail-Adresse werden nicht abgefragt. Gäste können nichts hochladen; die Beispiele verwenden
          aufgezeichnete KI-Antworten, es wird also kein Sprachmodell aufgerufen. Der Export eines Beispiels geht an ein simuliertes ERP
          innerhalb der Anwendung.
        </p>
        <p>
          Damit eine einzelne Person nicht alle Gastplätze eines Tages belegt, wird zu jedem Gastzugang ein mit einem geheimen Schlüssel
          gebildeter Hashwert Ihrer IP-Adresse gespeichert, nicht die Adresse selbst.
        </p>
        <p>
          Die Demo-Firma wird {hours}&nbsp;Stunden nach ihrer Anlage vollständig gelöscht: alle Einträge, die gespeicherten Dokumente, das
          Gastkonto mit seinen Sessions und der Hashwert.
        </p>
      </section>

      <section className="cs-section">
        <h2>5. KI-Auswertung hochgeladener Dokumente</h2>
        <p>
          Nur eingeladene Konten können Dokumente hochladen. Deren Inhalt wird an den KI-Dienst von RequestFlow übermittelt (ebenfalls bei
          Vercel betrieben). Der Dienst speichert nichts; er gibt den Text an ein Sprachmodell von Google weiter und liefert die erkannten
          Werte zurück. Vorgesehen ist dafür Vertex AI (Google Cloud) mit EU-Endpunkt. Für diese Vorführung ist abweichend vorübergehend
          die Gemini API von Google mit einem kostenlosen Schlüssel eingerichtet; nach den Bedingungen von Google können Inhalte dabei
          auch von Menschen geprüft werden. Deshalb werden hier ausschließlich synthetische Daten verarbeitet.
        </p>
      </section>

      <section className="cs-section">
        <h2>6. Cookies</h2>
        <p>
          Die Anwendung setzt nur das Sitzungs-Cookie der Anmeldung (gültig höchstens 8&nbsp;Stunden). Es ist für die von Ihnen gewünschte
          Funktion technisch nötig (§ 25 Abs.&nbsp;2 Nr.&nbsp;2 TDDDG). Es gibt keine Reichweitenmessung, kein Werbe-Tracking und keine
          Inhalte von Drittanbietern; Schriften werden von diesem Server geladen. Links zu GitHub werden erst beim Anklicken aufgerufen.
        </p>
      </section>

      <section className="cs-section">
        <h2>7. Speicherdauer</h2>
        <p>
          Gastzugänge werden nach {hours}&nbsp;Stunden gelöscht (Punkt 4). Eingeladene Konten und ihre Daten bleiben gespeichert, bis der
          Betreiber sie löscht; eine formlose Nachricht an die oben genannte E-Mail-Adresse genügt.
        </p>
      </section>

      <section className="cs-section">
        <h2>8. Ihre Rechte</h2>
        <p>
          Sie haben das Recht auf Auskunft (Art.&nbsp;15), Berichtigung (Art.&nbsp;16), Löschung (Art.&nbsp;17), Einschränkung der
          Verarbeitung (Art.&nbsp;18), Datenübertragbarkeit (Art.&nbsp;20) und Widerspruch gegen Verarbeitungen auf Grundlage berechtigter
          Interessen (Art.&nbsp;21 DSGVO). Eine formlose Nachricht an die oben genannte E-Mail-Adresse genügt.
        </p>
        <p>
          Außerdem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren, etwa beim Landesbeauftragten für den Datenschutz und
          die Informationsfreiheit Baden-Württemberg.
        </p>
      </section>

      <section className="cs-section">
        <h2>9. Verschlüsselung</h2>
        <p>Die Anwendung wird über HTTPS (TLS) ausgeliefert; der Browser wird angewiesen, sie nur verschlüsselt aufzurufen (HSTS).</p>
      </section>

      <p className="cs-foot">Stand: {OPERATOR.updated}</p>
    </main>
  );
}
