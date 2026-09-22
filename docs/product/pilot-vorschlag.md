# RequestFlow – Vorschlag für den Pilot

> Antwort auf eure Anfrage vom 22.09.2026 · Stand: Entwurf 2026-09-22
> Grundlage: `docs/input/2026-09-22-kundenanfrage.md`, Architekturentscheidung `docs/decisions/ADR-0001-pilot-architecture.md`

Hallo zusammen,

danke für die ausführliche Beschreibung – sie macht es leicht, konkret zu werden. Im Folgenden
beschreibe ich, wie ich das Projekt technisch und organisatorisch angehen würde, welchen
Pilot-Umfang ich empfehle und welche Fragen wir vor dem Start klären sollten.

---

## 1. Worum es geht – mein Verständnis

Euer Vertrieb erhält täglich 20–50 Angebotsanfragen per E-Mail. Die Angaben stecken im Mailtext
oder in PDF-, Excel- und Word-Anhängen und werden heute von Hand in die Auftragsübersicht
übertragen. Ziel ist eine interne Webanwendung, die diese Angaben automatisch vorbereitet,
**ohne dass die KI etwas erfindet** – und in der eure Mitarbeiter jede Angabe mit einem Blick
auf die Quelle prüfen, korrigieren und freigeben, bevor sie genau einmal ans ERP gehen.

## 2. So würde der Pilot aus Sicht eurer Mitarbeiter funktionieren

1. **Anfrage hochladen** – als gespeicherte E-Mail (`.eml`/`.msg`) oder als einzelne Dokumente.
   Doppelt hochgeladene Anfragen erkennt das System und weist darauf hin.
2. **Automatische Verarbeitung** – das System liest Mailtext und Anhänge (auch Tabellen und
   gescannte PDFs) und erkennt: Unternehmen, Ansprechpartner, Kontaktdaten, Positionen mit Menge,
   Material und Abmessungen, gewünschten Liefertermin und Zusatzanforderungen.
3. **Prüfen** – jede erkannte Angabe steht neben ihrer **Fundstelle** (Dokument, Seite bzw.
   Tabellenzelle, markierte Textstelle). Jede Angabe trägt einen Status:
   *erkannt* · *unsicher* · *nicht gefunden* · *nicht belegt*.
4. **Korrigieren und freigeben oder ablehnen** – jede Änderung und jede Freigabe wird mit Person
   und Zeitpunkt in der Historie festgehalten.
5. **Export** – freigegebene Anfragen gehen über eine REST-Schnittstelle an das ERP (im Pilot:
   eine simulierte Schnittstelle, die sich wie ein echtes ERP verhält, inklusive Ausfällen).

Status einer Anfrage: **Neu → Verarbeitung → Prüfung → Freigegeben → Exportiert**, außerdem
**Abgelehnt** und **Fehler** (mit sichtbarer Ursache und automatischer Wiederholung).

## 3. Wie ich eure wichtigsten Anforderungen absichere

| Eure Anforderung | Wie sie umgesetzt wird |
|---|---|
| **Die KI darf nichts erfinden** | Die KI muss zu jedem Wert die wörtliche Textstelle liefern. Das System **prüft selbst**, ob diese Stelle im Dokument wirklich steht und zum Wert passt. Ist das nicht der Fall, wird der Wert als *nicht belegt* markiert und muss geprüft werden. Die KI hat nie das letzte Wort. |
| **Quelle sichtbar** | Jeder Wert verweist auf Dokument und Stelle; die Prüfansicht zeigt beides nebeneinander. |
| **Nie doppelt ans ERP** | Jede Anfrage trägt einen eindeutigen Schlüssel, den die Schnittstelle bei Wiederholungen erkennt; zusätzlich schließt die Datenbank einen zweiten Export technisch aus. Das wird automatisiert getestet. |
| **Nichts geht verloren** | Eine Anfrage wird erst als angenommen bestätigt, wenn sie samt Verarbeitungsauftrag gespeichert ist. Fällt die KI oder das ERP aus, wird automatisch später wiederholt; der Fehler ist in der Übersicht sichtbar, eine manuelle Neuverarbeitung ist möglich. |
| **Jede Gesellschaft sieht nur ihre Daten** | Doppelt abgesichert: in der Anwendung und zusätzlich direkt in der Datenbank (Row-Level Security). Auch ein Programmierfehler in einer Abfrage kann keine fremden Daten liefern. Getestet mit zwei Gesellschaften. |
| **Nachvollziehbare Historie** | Jede Änderung wird zusammen mit der Änderung selbst gespeichert (wer, wann, alter/neuer Wert); die Historie ist nachträglich nicht veränderbar. |
| **Qualität der KI messbar** | Eine Testsammlung mit Beispielanfragen und erwarteten Ergebnissen misst je Feld: Trefferquote, erkannte Lücken, belegte Werte und „erfundene" Werte. Nach jeder Änderung an Prompt oder Modell läuft sie automatisch; verschlechtert sich ein Kernfeld, fällt der Check rot aus. |

## 4. Technischer Ansatz (Kurzfassung)

- **Webanwendung** (TypeScript, Next.js) als modularer Monolith: ein System mit klar getrennten
  Bausteinen (Eingang, Verarbeitung, Prüfung, Export, Benutzer, Historie) – einfach zu betreiben,
  gut erweiterbar.
- **KI-Dienst** (Python) für Dokumentenverarbeitung und Extraktion – mit docling, einer
  Open-Source-Bibliothek, die auch Tabellen und gescannte Dokumente zuverlässig liest. Der Dienst
  speichert selbst nichts und hat keinen Zugriff auf die Datenbank.
- **KI-Modell:** Google Gemini über Vertex AI mit **Verarbeitung in der EU**; laut
  Google-Cloud-Bedingungen werden eure Daten nicht zum Training verwendet. Das Modell ist
  austauschbar – ein Wechsel wird über die Testsammlung abgesichert.
- **Datenhaltung:** PostgreSQL für Anfragen, Ergebnisse und Historie; Dokumente in einem privaten,
  S3-kompatiblen Speicher. Hintergrundverarbeitung über eine Warteschlange in derselben Datenbank.
- **Anmeldung:** eigene Benutzerverwaltung (Einladung durch einen Admin, Rollen *Admin* und
  *Sachbearbeitung*), vorbereitet für die spätere Anmeldung über euer Microsoft-Konto (Entra ID).
- **Betrieb:** alles läuft als Container und kann in eurer Umgebung oder in einer EU-Cloud
  betrieben werden. Fehler, Wiederholungen und KI-Nutzung sind nachvollziehbar protokolliert –
  ohne Dokumentinhalte oder personenbezogene Daten in den Logs.

Details mit Begründungen und verworfenen Alternativen: Architekturentscheidung ADR-0001.

## 5. Empfohlener Pilot-Umfang

**Im Pilot enthalten**
- Upload von E-Mails (`.eml`, `.msg`) und Dokumenten (PDF inkl. Scans, Excel, Word)
- Automatische Extraktion der oben genannten Felder mit Fundstellen und Prüfung auf Belege
- Prüfansicht mit Korrektur, Freigabe und Ablehnung; Historie
- Status inkl. Fehlerstatus, automatische Wiederholung, Erkennung exakter Duplikate
- Export über die simulierte ERP-Schnittstelle (dokumentierter Schnittstellenvertrag)
- Anmeldung mit Einladung, zwei Rollen, Datenmodell für mehrere Gesellschaften
- Testsammlung (Start: 15 Fälle) mit automatischer Qualitätsmessung

**Bewusst nach dem Pilot**
- Anbindung eures echten Postfachs und eures echten ERP-Systems
- Anmeldung über Microsoft (Entra ID / SSO)
- Hinweise auf *ähnliche* (nicht identische) Anfragen, Rollenverwaltung per Oberfläche,
  eigene Betriebsübersicht
- Produktiver Rollout (Monitoring, Backups mit geprobter Wiederherstellung, Rollback)

## 6. Vorgehen und Zeitplan

| Phase | Inhalt | Dauer (Vorschlag) |
|---|---|---|
| **0 · Kickoff** | Ziele, Feldliste und Abnahmekriterien festlegen; 20–30 anonymisierte Beispielanfragen; Ansprechpartner | 1 Termin + Übergabe der Beispiele |
| **1 · Pilot-Entwicklung** | Umsetzung in kleinen, prüfbaren Schritten; **wöchentliche Demo** mit lauffähigem Stand | ca. 13 Arbeitstage (≈ 3 Wochen) |
| **2 · Pilotbetrieb** | 3–5 eurer Mitarbeiter arbeiten mit echten Anfragen; Feedback und Qualitätsmessung | 2 Wochen (Vorschlag) |
| **3 · Abnahme & Ausblick** | Abnahme gegen die vereinbarten Kriterien; Entscheidung über Postfach-/ERP-Anbindung und Rollout | 1 Termin |

**Zusammenarbeit:** ein fester fachlicher Ansprechpartner auf eurer Seite, der Fragen entscheidet;
offene Punkte und Fortschritt in einem gemeinsamen Board; jede Entscheidung mit Tragweite wird
schriftlich festgehalten. Neue oder unklare Anforderungen setze ich nicht stillschweigend um,
sondern kläre sie vorher mit euch.

## 7. Abnahmekriterien (Vorschlag – Zielwerte legen wir im Kickoff fest)

- [ ] Eine Anfrage mit Anhängen läuft ohne Medienbruch vom Upload bis zum Export.
- [ ] Kein Wert steht als *erkannt* ohne überprüften Beleg im Dokument.
- [ ] Extraktionsqualität je Kernfeld ist gemessen und erreicht die vereinbarten Zielwerte.
- [ ] Doppelter Export und Verlust bei simuliertem Ausfall sind per Test ausgeschlossen.
- [ ] Mitarbeiter einer Gesellschaft sehen nachweislich keine Daten einer anderen.
- [ ] Die Historie zeigt jede Änderung und Freigabe mit Person und Zeitpunkt.
- [ ] Die Bearbeitungszeit pro Anfrage ist im Pilotbetrieb gegenüber heute gemessen.

## 8. Datenschutz

- Verarbeitung in der EU (Anwendung, Datenbank, Dokumentenspeicher, KI-Modell).
- Auftragsverarbeitungsvertrag (AVV) zwischen uns, sofern ich den Pilot betreibe; die
  Unterauftragsverarbeiter (Hosting, KI-Anbieter) lege ich vollständig offen.
- Datenminimierung: Logs enthalten keine Dokumentinhalte; Aufbewahrungsfristen legen wir gemeinsam fest.
- Für Entwicklung und Tests verwende ich ausschließlich synthetische oder von euch anonymisierte Daten.

## 9. Offene Fragen vor dem Start

**Fachlich**
1. Wer entscheidet fachlich und nimmt den Pilot ab?
2. Welche Felder braucht eure Auftragsübersicht genau (Feldliste/Beispiel-Datensatz)?
3. Wie sieht heute eine „gute" Anfrage vs. eine schwierige aus – gibt es typische Sonderfälle?
4. Wie lange dauert die manuelle Erfassung heute pro Anfrage (für den Vorher-Nachher-Vergleich)?

**Daten und Dokumente**
5. Können wir 20–30 anonymisierte Beispielanfragen bekommen (inkl. Anhänge)?
6. Wie hoch ist der Anteil gescannter PDFs, Zeichnungen oder Bilder? Welche Sprachen kommen vor?
7. Wie lange sollen Original-Mails, Dokumente und Historie aufbewahrt werden?

**IT und Integration**
8. Welches ERP-System nutzt ihr, und welche Schnittstelle bietet es (REST, Datei-Import, Middleware)?
9. Welches Mailsystem (Microsoft 365, Exchange on-prem, anderes)?
10. Wo soll der Pilot laufen – in eurer Umgebung (Container) oder von mir in einer EU-Cloud betrieben?
11. Nutzt ihr Microsoft Entra ID für die Anmeldung, und ist MFA Pflicht?

**Datenschutz und Organisation**
12. Welche KI-Anbieter/Regionen sind bei euch zulässig? Ist eine Zusage ohne Datenspeicherung beim KI-Anbieter (Zero Data Retention) erforderlich?
13. Wer ist bei euch Ansprechpartner für Datenschutz (AVV)?
14. Wie viele Mitarbeiter sollen im Pilot testen, und aus wie vielen Gesellschaften?

## 10. Aufwand und nächste Schritte

- **Pilot-Entwicklung:** ca. 13 Arbeitstage; Pilotbetrieb-Begleitung nach Aufwand.
- **Konditionen:** [Tagessatz / Festpreis eintragen – kommerzielles Angebot]
- **Laufende Kosten im Pilot:** KI-Nutzung und Hosting im niedrigen Bereich; genaue Zahlen nach der
  ersten Messung mit euren Beispielanfragen.

**Nächste Schritte:** Kickoff-Termin vereinbaren, Beispielanfragen und Feldliste bereitstellen,
fachlichen Ansprechpartner benennen. Danach starte ich mit der Umsetzung.

Viele Grüße
Florian Hein
