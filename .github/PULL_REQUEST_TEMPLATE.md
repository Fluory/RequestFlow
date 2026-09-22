<!-- Die PR-Beschreibung ist der AKTUELLE Gesamtstand – bei jedem Push aktuell halten.
     Übergaben (Account voll, blockiert, wichtige Erkenntnis) kommen als eigener
     PR-KOMMENTAR (append-only, Format unten) – nie durch Überschreiben hierher.
     scripts/pr-check.sh prüft in der CI: Klartext ausgefüllt, Plan-Pflicht beantwortet
     (bei Auslöser: Impact Manifest), genau eine Doku-Entscheidung, Dateigrößen-Gate
     (300/500/800/1000), Before-creating-Nachweis, bei Draft der nächste Schritt, bei
     Ready-for-review ein grünes verify. -->

## Warum

Fixes #<nr>

## Arbeitsstand

<!-- Pflicht, solange der PR Draft ist oder ein Agent blockiert ist – die nächste Session liest zuerst hier. -->
- **Ziel:** <ein Satz>
- **Nicht-Ziele:** <…>
- **Erledigt:** <…>
- **Offen:** <…>
- **Annahmen:** <…>
- **Nächster kleinster Schritt:** <…>

## Was ist passiert (Klartext)

<Pflicht. Einfache, aber nicht banale Sprache: Was wurde geändert, warum, und was
bedeutet das für das Projekt? So geschrieben, dass man es ohne Code-Kontext versteht.>

## Plan-Pflicht (SYSTEM.md §4)

- [ ] Kein Auslöser – keine Modulgrenze, öffentliche API, Migration, Auth/Rechte, kein Zahlungs-/Daten-/Infrapfad, höchstens zwei Module, keine Architekturvarianten, umkehrbar
- [ ] Auslöser zutreffend – Impact Manifest ausgefüllt (Plan vor Code)

### Impact Manifest

<!-- Nur bei Plan-Pflicht. Der Plan lebt hier – nicht in einer PLANNING.md. -->
- **Betroffene Module:**
- **Schnittstellen / Datenänderungen:**
- **Akzeptanzkriterien:**
- **Testplan:**
- **Verifizierte Fakten:**
- **Offene Annahmen:**
- **Nicht-Ziele:**
- **Risiken und Rollback:**

## Geändert

- <Datei/Bereich>: <was und warum>

## Nachweis (SYSTEM.md §11)

- `verify:changed`: <grün / rot – letzter fokussierter Test>
- `verify`: <grün / rot>
- `verify:full` / E2E-Spec: <ausgeführt: welche – oder: nicht betroffen>
- Manueller Prüfnachweis: <Schritt → Ergebnis, falls zutreffend>
- Frischer Review (P1 vor Ready-for-review; Architektur/API/DB immer): <Link zum Review-Kommentar – oder: noch offen>

## Doku-Entscheidung (genau eine)

- [ ] Keine langlebige Doku betroffen – Begründung: <…>
- [ ] Doku betroffen und im selben PR aktualisiert:
  - [ ] Produktdoku (P0: README): <Pfad>
  - [ ] Technische Doku: <Pfad>
  - [ ] Architekturkarte: <Pfad>
  - [ ] ADR: <Pfad>
  - [ ] CHANGELOG `[Unreleased]` (sichtbares Feature oder Verhalten – im selben PR, nie „später")

Entferntes oder Umbenanntes: `docs/` + README gegrept, Treffer bereinigt: <ja / nichts entfernt>

## Dateigrößen und neue Bausteine (SYSTEM.md §7)

Dateien über 500 Zeilen im Diff (Ausnahmen: generierter Code, Lockfiles, Fixtures, Migrationen, Schemas, Ressourcen, Doku, Konfiguration):
- [ ] keine
- [ ] bewusst belassen – Begründung: <…>
- [ ] im selben PR nach fachlicher Verantwortung geteilt
- [ ] Folge-Issue #<nr>

Über 800 Zeilen mit neuer Fachlogik oder über 1000 Zeilen (P1/P2): <Ausnahme mit Begründung, Issue oder ADR – sonst „nicht betroffen">

Neue Shared-Komponente, Utility-Datei, Adapter oder fachlicher Service:
- [ ] nein
- [ ] ja – gesucht nach: <Begriffe/Orte>; gefunden: <nichts Gleiches / was und warum nicht genutzt>

## Subagent-Einsätze

<Agent/Modell – wofür – Ergebnis. „Keine" ist eine gültige Antwort.>

## Risiken / offene Punkte

- Keine

<!-- Format für Übergabe-KOMMENTARE (nicht hier in die Beschreibung):

## Übergabe
**Status:** WIP
**Erledigt:** …
**Offen:** …
**Nächster Schritt:** …
**Risiko:** z. B. „Tests aktuell rot"
-->
