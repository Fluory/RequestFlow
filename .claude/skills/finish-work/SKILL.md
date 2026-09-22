---
name: finish-work
description: Beendet eine Arbeitssession nach Systemregeln. Verwenden bei "Fertig", "Beende die Session", "Ich wechsle den Account", "Bereite den PR vor" oder vor jedem Sessionende mit offener Arbeit. Verhindert ungepushte Arbeit, zurückgelassene Worktrees, fehlende Tests und unklare Übergaben.
---

# /finish-work – Session sauber abschließen

## Ablauf

1. `git status` prüfen; uncommitted und ungepushte Änderungen **sichtbar auflisten**.
2. Kanonisches verify-Kommando (AGENTS.md „Prüfen") **und** `scripts/doku-check.sh` ausführen; Ergebnis ehrlich berichten – bei Fix-Schleifen gilt das Stuck-Protokoll (SYSTEM.md §4): zweiter Versuch nur mit neuer Hypothese, nach zwei Fehlschlägen zurücksetzen, dokumentieren, `blocked`.
3. Akzeptanzkriterien des Issues gegen den Stand prüfen (Testplan-Abgleich).
4. **Doku-Entscheidung** treffen (genau eine): keine langlebige Doku betroffen – oder Produktdoku, technische Doku, Architekturkarte, ADR, CHANGELOG im selben PR aktualisiert.
5. PR-Beschreibung aktualisieren: **Arbeitsstand** (Erledigt, Offen, Annahmen, nächster kleinster Schritt), **Nachweis** (verify-Stufen, letzter fokussierter Test, E2E falls betroffen) und **„Was ist passiert (Klartext)"** – `scripts/pr-check.sh` prüft die Struktur in der CI.
6. Bei WIP/Abgabe: **Übergabe-Kommentar** (append-only) in den PR: Erledigt / Offen / Nächster Schritt / Risiko.
7. Alles committen und pushen.
8. Status eindeutig setzen: `ready-for-review` | `WIP` | `blocked` | `decision-needed` – und im Project-Board spiegeln.
9. Cleanup **nur wenn** alles gepusht ist und ein PR existiert: Worktree entfernen. Bei offenem Draft-PR darf er bleiben.

## Grenzen

- **Nie** unfertige Arbeit stillschweigend als fertig markieren – rote Tests ⇒ Status bleibt `WIP`, klar benannt.
- Kein Merge (das ist die Reviewer-Rolle), kein Force-Push, kein Verwerfen von Änderungen ohne ausdrückliche Bestätigung.
- Fehlt das Issue oder der PR: erst nachziehen, dann abschließen.

## Ergebnis

Kurze Meldung: Status, PR-Link, Testergebnis, was offen ist – plus Übergabe-Kommentar bei WIP. Braucht der Mensch eine Entscheidung: Hintergrund, Optionen mit Folgen und Empfehlung im Chat (SYSTEM.md §6), nie nur die nackte Frage.
