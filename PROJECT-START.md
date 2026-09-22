# Project Start

> **Zweck:** Diese Datei führt Orchestrator und KI-Session durch die Gründung eines neuen Projekts.
> Sie wird zu Beginn gemeinsam ausgefüllt, im Initialisierungs-PR committed und danach nur bei grundlegenden Richtungsänderungen aktualisiert.
>
> **Regel:** Die KI stellt offene Fragen, macht Vorschläge und dokumentiert Entscheidungen. Der Orchestrator entscheidet Ziel, Scope, Risiko, Budget und Priorität.

## 0. Arbeitsmodus

**Session-Auftrag:**
1. Lies diese Datei vollständig.
2. Stelle nur die noch offenen Fragen aus Abschnitt 1–6.
3. Mache keine Implementierung, keine Cloud-Anlage und keinen Projekt-Setup-Commit, bevor Abschnitt 7 vom Orchestrator freigegeben wurde.
4. Halte Antworten kurz, strukturiert und entscheidungsorientiert.
5. Wenn eine Entscheidung sicherheits-, kosten-, daten- oder architekturrelevant ist: Optionen mit Folgen nennen und `decision-needed` markieren.

**Aktueller Status:** `setup-in-progress` (Freigabe 2026-09-22)
Mögliche Werte: `discovery` | `approved-for-setup` | `setup-in-progress` | `foundation-ready` | `paused`

**Orchestrator:** Fluory
**Projektverantwortung:** Fluory
**Datum gestartet:** 2026-09-22

---

## 1. Problem und Ziel

> Quelle: `docs/input/2026-09-22-kundenanfrage.md` (Kundenauftrag, Eingang 2026-09-22). Was dort nicht steht, ist hier
> als **Vorschlag** oder **offen** markiert – nichts davon ist mit dem Kunden abgestimmt.
>
> **Projektcharakter (entschieden 2026-09-22, Orchestrator):** Referenz-/Testprojekt – der Kunde
> ist ein Übungsfall, wird aber **wie ein echter Kundenauftrag** behandelt: Vorschlag, Discovery,
> Pilot und Betrieb in Kundenqualität. Es gibt **keine echten Kunden- oder Personendaten** –
> alle Anfragen, Anhänge und Eval-Fälle sind synthetisch. Ergebnis: Kunden-Vorschlag + Pilot.

### Problem
Der Vertrieb eines mittelständischen Anlagen- und Maschinenbauers erhält täglich **ca. 20–50
Angebotsanfragen per E-Mail**. Die relevanten Angaben stehen im Mailtext oder in Anhängen
(PDF, Excel, Word). Mitarbeiter öffnen jede Anfrage, suchen die Angaben manuell heraus und
übertragen sie in die interne Auftragsübersicht.

### Zielgruppe
Vertriebsmitarbeiter des Kunden (mehrere Nutzer); perspektivisch mehrere Gesellschaften der
Unternehmensgruppe, die strikt nur ihre eigenen Daten sehen dürfen.

### Nutzenversprechen
Anfrage rein → strukturierte, vom Menschen geprüfte Daten mit **Quellenbeleg** raus – ohne
Abtippen. Die KI erfindet nichts; Unsicheres wird markiert. Freigegebene Anfragen gehen genau
einmal ans ERP; keine Anfrage geht bei Ausfällen verloren.

### Erster Meilenstein
**Pilot:** vollständig nutzbare End-to-End-Version, mit einigen Mitarbeitern testbar:
Anfrage erhalten/hochladen → Dokumente verarbeiten → Informationen extrahieren → prüfen und
korrigieren → freigeben → Export über (simulierte) REST-Schnittstelle.

### Erfolgskriterien
> **Vorschlag – vom Kunden nicht beziffert, Zielwerte mit ihm festlegen.**
- [ ] Pilotnutzer bearbeiten reale Anfragen vollständig in der App – vom Eingang bis zum Export (kein Medienbruch)
- [ ] Extraktionsqualität je Kernfeld ist auf einem Eval-Set gemessen und reproduzierbar; Zielwert je Feld mit Kunde vereinbart
- [ ] Kein doppelter ERP-Export und keine verlorene Anfrage bei Ausfall externer Dienste – durch automatisierte Tests belegt
- [ ] Bearbeitungszeit je Anfrage messbar kürzer als heute (Baseline vom Kunden nötig)

### Nicht-Ziele
- Echte ERP-Anbindung (Pilot: simulierte REST-Schnittstelle) – *laut Anfrage*
- Anbindung des echten Produktiv-Postfachs und produktiver Rollout – *laut Anfrage erst nach dem Pilot*
- „Perfekte Enterprise-Lösung" – *laut Anfrage*
- *Vorschlag:* SSO/Active-Directory-Login, Mehrgesellschafts-Betrieb aktiv (nur im Datenmodell vorbereitet), Angebotskalkulation/Preise, mobile Nutzung

### Offene Produktfragen
> An den Kunden – Grundlage für den Vorschlag. Vollständige Liste: `docs/product/pilot-vorschlag.md` §9.
- [ ] Welches ERP, welche Zielfelder – gibt es eine Feldliste/ein Schema der Auftragsübersicht?
- [ ] Wie sehen reale Anfragen aus (Beispiele, anonymisiert)? Anteil gescannter PDFs/Bilder, Sprachen?
- [ ] Welche KI-Anbieter und Regionen sind zulässig (AVV, EU-Datenresidenz, kein Training)?
- [ ] Wer entscheidet fachlich, wer nimmt den Pilot ab – gegen welche Kriterien?

---

## 2. Scope und Nutzerablauf

### Nutzerrollen
| Rolle | Darf / braucht |
|---|---|
| Sachbearbeiter (Vertrieb) | Anfragen hochladen, Extraktion prüfen, Werte korrigieren, freigeben oder ablehnen, Fehler sehen und Neuverarbeitung anstoßen – nur Daten der eigenen Gesellschaft |
| Admin (je Gesellschaft) | zusätzlich Benutzer anlegen/sperren, Rollen vergeben – *genaues Rechtemodell offen* |
| System (Postfach-Import, Worker) | Mails abholen, Dokumente verarbeiten, extrahieren, exportieren – jede Aktion im Audit-Log |

**Anfrage-Status (laut Kunde):** Neu → Verarbeitung → Prüfung → Freigegeben → Exportiert; plus Fehler
(und *Vorschlag:* Abgelehnt als Endstatus, da „ablehnen" gefordert, aber kein Status dafür genannt).

### Erster Vertical Slice
```text
Sachbearbeiter lädt eine Anfrage hoch (.eml/.msg oder PDF/Excel/Word)       → Status Neu
  ↓   Duplikat-Prüfung (Inhalts-Hash); Treffer wird angezeigt, nicht still verworfen
System extrahiert Text je Dokument, KI liefert Felder mit Quellenbeleg      → Verarbeitung
  ↓   (Dokument + Stelle); Unsicheres/Fehlendes wird markiert, nie geraten
Sachbearbeiter prüft Feld für Feld neben der Quelle, korrigiert             → Prüfung
  ↓   jede Änderung mit Wer/Wann/Alt/Neu in der Historie
Sachbearbeiter gibt frei (oder lehnt ab)                                    → Freigegeben
  ↓
System exportiert genau einmal an die ERP-Simulation (Idempotenz-Schlüssel) → Exportiert
  ↓
Fehlerfall: KI/ERP nicht erreichbar → Job wird wiederholt, Status Fehler mit
            sichtbarer Ursache, manuelle Neuverarbeitung – Anfrage geht nie verloren
```

### Grobe Epics
- [ ] Eingang: Upload + Postfach-Import (Pilot: Test-Postfach – *offen*)
- [ ] Dokumentverarbeitung: Mail, PDF, Excel, Word → Text mit Positionsangaben (OCR *offen*)
- [ ] KI-Extraktion mit Quellenbelegen und Unsicherheitsmarkierung
- [ ] Prüf-Oberfläche: Feld ↔ Quelle, Korrektur, Freigabe/Ablehnung
- [ ] Export: ERP-Simulation (REST), Idempotenz, Retry
- [ ] Identität: Login, Rollen, Mandantentrennung je Gesellschaft
- [ ] Nachvollziehbarkeit: Audit-Historie, Statusmaschine, Duplikaterkennung
- [ ] Zuverlässigkeit: Job-Queue, Retry, sichtbare Fehler
- [ ] KI-Qualität: Eval-Set der Kernfelder, Regressionsvergleich bei Prompt-/Modellwechsel
- [ ] Betrieb: Deployment, Logs, Backups – *Hosting offen*

---

## 3. Reifegrad und Risiko

### Projektstufe
- [ ] P0 – Experiment / lokaler Proof of Concept
- [x] P1 – internes Tool / Beta / Unternehmensdaten
- [ ] P2 – produktives SaaS / Kunden / kritischer Prozess

> **Entschieden 2026-09-22 (Orchestrator):** P1 für Discovery bis Pilot (M0–M2) →
> **Reifegradwechsel auf P2 als eigener PR vor dem produktiven Rollout** (M4).
> Add-on SaaS/Auftrag ab Start, weil externer Auftraggeber (SYSTEM.md §14).

### Repository
- Sichtbarkeit: **`public`** (entschieden 2026-09-22, Orchestrator)
- Begründung: Referenzprojekt als öffentlicher Nachweis (Portfolio). Kein realer Kunde, keine
  Unternehmensinterna; Code, Issues und Testdaten sind durchgehend synthetisch. Bedingung: Wird
  daraus je ein echter Auftrag, laufen Kundendaten nie durch dieses Repo (eigenes privates Repo/Fork).
- Sprache: englisch für Code, technische Doku, ADRs, Commits, PR-Titel (bei öffentlichen Projekten auch Issue-Titel und Akzeptanzkriterien); nutzernahe, Kunden- und Rechtstexte nach Zielgruppe (SYSTEM.md „Sprache und Portfolio")

### Risikoprofil
| Frage | Ja/Nein | Konsequenz / offene Frage |
|---|---|---|
| Öffentliche Nutzer? | Nein | Interne Anwendung; Login-Seite ggf. aus dem Internet erreichbar (Hosting offen) |
| Login / Rollen? | **Ja** | Login + einfache Benutzer-/Rechteverwaltung laut Anfrage; serverseitige Autorisierung |
| Personenbezogene Daten? | **Ja** | Ansprechpartner + Kontaktdaten der Anfragenden; Mitarbeiterkonten im Audit-Log |
| Vertrauliche Unternehmensdaten? | **Ja** | Anfragen, Spezifikationen, Zeichnungen der Endkunden des Kunden |
| Persistente Datenbank? | **Ja** | Anfragen, Extraktionen, Historie; Backup/Restore nötig |
| Datei-Upload oder Download? | **Ja** | PDF/Excel/Word/Mail – Größen-/Typlimits, Malware-Risiko, Parser-Härtung |
| Externe APIs? | **Ja** | KI-Anbieter, Postfach (IMAP/Graph), ERP (Pilot: Simulation) – Timeouts, Retry |
| LLM, RAG oder Agentenfunktion? | **Ja** | Extraktion (kein RAG); „nichts erfinden" + Eval-Set laut Anfrage; Prompt-Injection über Anhänge |
| Zahlungen / Rechnungen? | Nein | |
| Öffentliche API? | Nein | Export ist ausgehend; ERP-Schnittstelle als interner Vertrag |
| Öffentliche Website (Impressum/Datenschutz nötig)? | Nein | Internes Tool – Datenschutzinformation für Nutzer trotzdem nötig |
| Externer Auftraggeber? | **Ja** | Scope, Abnahme, AVV (du als Auftragsverarbeiter, falls du hostest), fachlicher Entscheider |

### Aktivierte Add-ons
> Aus dem Risikoprofil abgeleitet – **bestätigt 2026-09-22 (Orchestrator)**.
> Infrastruktur wird mit dem Showcase-Deploy aktiviert, Releases mit der ersten Auslieferung.
- [x] Security-Basis – Login, Mandanten, Datei-Upload
- [x] Datenschutz – Personendaten, AVV-Kette inkl. LLM-Anbieter
- [x] Datenbank – persistente Daten, Migrationen, Backups
- [ ] Infrastruktur – erst mit Hosting-Entscheidung
- [x] Betrieb / Monitoring – Laut Anfrage „nachvollziehbarer Betrieb", sichtbare Fehler
- [x] API-Contracts – ERP-Schnittstelle als stabiler Vertrag (Simulation → echt)
- [x] KI / RAG Governance – Prompts versioniert, Eval-Set, fail-closed, Injection-Tests
- [ ] Releases – erst ab Auslieferung an den Kunden
- [ ] Recht – keine öffentliche Website; AVV/Vertrag laufen über SaaS/Auftrag + Datenschutz
- [x] SaaS / Auftrag – externer Auftraggeber (SYSTEM.md §14)

---

## 4. Technikentscheidungen

> Die KI schlägt Optionen vor. Entscheidungen mit langfristiger Wirkung werden hier festgehalten und bei Annahme später als ADR ausgearbeitet.

### Stack-Defaults

Referenz: `Entwicklungsplan/STACK-DEFAULTS.md`. Dort steht, was systemweit festgelegt ist
(GitHub, Actions, Feature-Module) und was **bewusst frei** bleibt (u. a. Programmiersprache –
pro Projekt hier entscheiden und dokumentieren). Abweichungen von Festlegungen brauchen
Begründung, Auswirkungsanalyse und bei langfristiger Wirkung einen ADR.

### Plattform und Tech Stack
> Die Session schlägt hier **mehrere gleichwertige Optionen mit Folgen** vor, hergeleitet aus
> den Anforderungen dieses Projekts – keine Hausnorm, keine Lieblingsstacks (STACK-DEFAULTS.md).

| Bereich | Entscheidung | Warum | Status |
|---|---|---|---|
| Frontend/UI-Rahmen | Next.js (App Router) + Tailwind + shadcn/ui | Modularer Monolith, ein Codebase für UI + Server (ADR-0001 D1) | entschieden 2026-09-22 |
| Backend/Sprache | TypeScript (Node 24) für App/Worker + zustandsloser Python-3.13-AI-Service (FastAPI) | Dokumentenqualität ab Tag 1 via docling; Security/Tenancy bleiben in TS (D1, D2, D8) | entschieden 2026-09-22 |
| Datenbank | PostgreSQL 17 + Drizzle; Queue pg-boss 12 im selben Postgres | Transaktionaler Job-Eintrag = keine verlorene/doppelte Anfrage (D3, D4) | entschieden 2026-09-22 |
| Auth | Better Auth ≥1.7.5, nur Einladung, organization + admin; RLS + Repository-Scoping | EU-resident, offline lauffähig, Weg zu Entra-SSO (D6, D7) | entschieden 2026-09-22 |
| Hosting | Lokal Docker Compose; Showcase nach Abnahme auf Vercel + Neon (FRA) + R2 EU; AI-Service-Host per Spike | Reproduzierbar, gleicher Image-Pfad in Produktion (D5, D11) | entschieden 2026-09-22 |
| CI | GitHub Actions (systemweit festgelegt) | SYSTEM.md §11 | gesetzt |
| Observability | JSON-Logs ohne PII, Audit in derselben Transaktion, Health-Endpoint | „Nachvollziehbarer Betrieb" laut Anfrage (D10) | entschieden 2026-09-22 |
| KI/RAG | Vertex AI `eu`, gemini-3.5-flash; Grounding-Check im Code; Eval-Set mit CI-Gate; Gemini Free Tier nur lokal + synthetisch | Kundenanforderungen „nichts erfinden" + „Qualität nachvollziehbar" (D8) | entschieden 2026-09-22 |

> Vollständige Begründung, Alternativen, Trade-offs und Neubewertungs-Trigger: `docs/decisions/ADR-0001-pilot-architecture.md` (Accepted 2026-09-22).

### Nicht verhandelbare technische Regeln
- Fachlogik wird feature-orientiert unter `src/features/` organisiert.
- Jede echte Arbeit nutzt Issue → Branch/Worktree → Draft-PR → Review → Merge.
- `main` ist der geprüfte Produktstand.
- Secrets gehören nie in Git, Chat, Logs oder Prompts.
- Neue Dependencies brauchen eine PR-Begründung.

### Architektur-Skizze
Siehe Abschnitt „Overview" in `docs/decisions/ADR-0001-pilot-architecture.md` (Browser → web/worker (TS) → PostgreSQL + S3; worker → stateless AI-Service (Python) → Vertex AI `eu`; Export → ERP-Mock).

### Entscheidungsbedarf
Keine offene Architekturentscheidung – ADR-0001 ist angenommen. Offene Prüfpunkte der Umsetzung und Kundenfragen: ADR-0001 „Open points".

---

## 5. Sicherheit, Daten und Betrieb

### Datenklassifikation
| Datenart | Klasse | Speicherort | Zugriff | Aufbewahrung |
|---|---|---|---|---|
| Kontaktdaten der Anfragenden (Name, E-Mail, Telefon, Firma) | personenbezogen | DB (Hosting offen) | Sachbearbeiter der eigenen Gesellschaft | offen – mit Kunde festlegen |
| Original-Mails und Anhänge | vertraulich (+ personenbezogen) | Objektspeicher (offen) | wie oben | offen |
| Extrahierte Felder + Quellenbelege | vertraulich | DB | wie oben | offen |
| Audit-Historie (wer/wann/was) | personenbezogen (Mitarbeiter) | DB, nur anhängend | Admin der Gesellschaft | offen – Nachweispflichten vs. Löschung |
| Texte in KI-Prompts | vertraulich (+ personenbezogen) | beim KI-Anbieter (transient) | – | nur mit AVV, EU-Region, Trainingsausschluss |
| Eval-Set | synthetisch oder vom Kunden freigegeben | Repo nur wenn synthetisch/anonymisiert | Entwickler | Projektdauer |

### Minimale Sicherheitsmaßnahmen
- [ ] MFA für GitHub, Cloud, Domain und E-Mail aktiviert
- [ ] `.env` und lokale Credentials sind ignoriert
- [ ] Secret Scan und Dependency Scan vorgesehen
- [ ] TLS/HTTPS erforderlich, falls öffentlich
- [ ] Authentifizierung und serverseitige Autorisierung geklärt
- [ ] Rate Limits / Timeouts / Größenlimits bei öffentlichen oder teuren Endpunkten geplant
- [ ] Backup und Wiederherstellung bei persistenten Daten geplant
- [ ] Logging ohne Secrets oder unnötige personenbezogene Daten
- [ ] `.claude/settings.json` aus `templates/base/`: Read-Sperren für Secrets, Artefakt-Wächter, Auto Memory aus (SYSTEM.md §10)

### Betrieb
| Thema | Entscheidung |
|---|---|
| Dev-Umgebung | Lokal `docker compose up`: postgres:17, SeaweedFS, web, worker, ai – nur synthetische Daten (ADR-0001 D11) |
| Staging | Keine im Pilot (P1); der Showcase nach Abnahme dient als Demo-Umgebung |
| Produktion | Nach dem Pilot, in Kundenumgebung oder EU-Cloud – offen (Kundenfrage 10) |
| Health Check | `GET /api/health`: DB, Storage, Queue-Rückstand, AI-Service erreichbar (D10) |
| Logs | JSON-Logs (pino / Python), Korrelations-IDs, keine Dokumentinhalte/PII (D10) |
| Backup / Restore | Pilot lokal: entfällt (synthetisch, reproduzierbar per Seed); Showcase: Neon-Standard; Produktion: PITR + geprobter Restore (Add-on Datenbank) |
| Rollback | Pilot: Revert-PR + Re-Deploy; Migrationen nur vorwärtskompatibel; Produktion: Rollback per Image-Tag (vor P2 ausarbeiten) |
| Kostenlimit | Lokal 0 € + KI-Nutzung (Gemini Free Tier nur lokal/synthetisch); Showcase auf Free Tiers (Vercel Hobby, Neon Free, R2 Free) + Vertex mit GCP-Budget-Alert bei **10 €/Monat** (entschieden 2026-09-22) |
| Agent-Sandbox (ab P1 risikobasiert, SYSTEM.md §10) | **`false` (entschieden 2026-09-22):** nur synthetische Daten, keine Produktions-Credentials; Windows-Host ohne WSL2 (Sandbox nur macOS/Linux/WSL2). Neu bewerten, sobald echte Credentials oder Kundendaten ins Spiel kommen |

---

## 6. Planung und Arbeitsfluss

### GitHub Project
`Inbox → Ready → In Progress → In Review → Done`

### Labels
`idea`, `feature`, `bug`, `tech-debt`, `security`, `blocked`, `decision-needed`, `ready`, `ai`, `verify-full`

### Merge-Regeln
Es gilt die Risikomatrix aus SYSTEM.md §5 (P0 klein: Autor nach Checkliste · P1 Feature: Zweit-Account/Review-Session · Architektur/API/DB und alles ab P2: menschliche Freigabe).

### Erstes Epic
**#2 – Epic 1: Vertical Slice – eine Anfrage Ende-zu-Ende** (dünn durch alle Schichten, dann verbreitern)

### Erste umsetzbare Issues
> Angelegt beim Setup (2026-09-22) mit Ziel, Akzeptanzkriterien, Nicht-Zielen, Testplan.
> #3 ergänzt gegenüber dem Discovery-Entwurf: Ohne App-Gerüst (Compose, verify-Befehle) hätte kein Slice-Issue einen Startpunkt.
- [ ] #3 `chore(app)`: TS app skeleton, docker compose and verify commands – **ready**
- [ ] #4 `feat(identity,tenancy)`: invite-only login, companies and forced RLS
- [ ] #5 `feat(intake)`: upload a request and enqueue processing atomically
- [ ] #6 `feat(ai-service)`: stateless extraction service with grounding verifier
- [ ] #7 `feat(jobs,extraction)`: process requests in the worker with retries and visible errors
- [ ] #8 `feat(review)`: review fields beside their source, correct, approve or reject
- [ ] #9 `feat(export)`: export approved requests exactly once to the ERP mock

**Add-on-Checklisten:** #10 Security · #11 Datenschutz · #12 Datenbank · #13 Betrieb · #14 API · #15 KI/RAG · #16 SaaS/Auftrag
**Folge-Epics:** #17 Vollständige Extraktion & Qualität · #18 Robustheit & Betrieb · #19 Showcase (nach Abnahme)

---

## 7. Setup-Freigabe

> Erst nach dieser Freigabe darf eine KI-Session das Repository und die Basisstruktur erzeugen.

- [x] Problem, Ziel und Nicht-Ziele verstanden
- [x] Erster Vertical Slice festgelegt
- [x] Projektstufe und Risikoprofil entschieden
- [x] Repository-Sichtbarkeit entschieden
- [x] Tech-Stack entschieden oder offene Entscheidung als Issue angelegt
- [x] Aktivierte Add-ons bestätigt
- [x] Budget-/Kostenrahmen bekannt
- [x] Orchestrator gibt Setup frei

**Freigabe durch:** Fluory · **Datum:** 2026-09-22

---

## 8. Setup-Auftrag an die KI

Nach Freigabe führt die Setup-Session ausschließlich diese Schritte aus:

1. Repository erstellen bzw. klonen.
2. `templates/base/` passend zur Projektstufe übernehmen (P0-Minimalstruktur, ANLEITUNG.md A.2).
3. `project-profile.yml` aus diesem Dokument ableiten.
4. `AGENTS.md` als projektbezogene Agentenkarte (englisch), `CLAUDE.md` mit `@AGENTS.md`-Import und `# Compact instructions`, `.claude/` mit Wächtern, Rules und Kern-Skills erstellen.
5. Architektur-Kurzfassung erstellen (leer erlaubt – nur Entschiedenes).
6. Issue-/PR-Templates, Labels und GitHub Project anlegen.
7. Schlanke PR-CI einrichten; bei öffentlichem Repo Branch Protection.
8. Initialisierungs-PR öffnen: `chore: initialize project foundation` – mit erstellten Dateien und Warum, Test-/Lint-/Build-Befehlen, offenen Entscheidungen, nächstem `ready`-Issue.

### Setup-Abschluss
- [ ] Repository erreichbar · Initialisierungs-PR existiert · CI läuft (oder Einschränkung dokumentiert)
- [ ] Board, Labels und Vorlagen vorhanden
- [ ] Vertical-Slice-Epic existiert, mindestens ein Issue `ready`
- [ ] Kein Secret committed

**Status nach Setup:** `foundation-ready`
