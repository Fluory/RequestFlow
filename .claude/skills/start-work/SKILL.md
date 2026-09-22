---
name: start-work
description: Startet die Arbeit an einem GitHub-Issue nach Systemregeln. Verwenden bei "Arbeite an Issue #N", "Starte das Feature", "Übernimm diesen Bug" oder jedem Beginn echter Implementierungsarbeit. Verhindert Arbeit ohne ready-Issue, Claim, Branch, Worktree und Draft-PR.
---

# /start-work – Arbeit regelkonform beginnen

## Ablauf

1. `AGENTS.md` des Projekts lesen (nur diese, nicht die ganze Doku).
2. Issue prüfen: Existiert es? Trägt es `ready` (Definition of Ready erfüllt)? Ist es `blocked` oder hat unerledigte Abhängigkeiten? → Wenn nein: **stoppen** und dem Orchestrator melden, nicht improvisieren.
3. Kollisionscheck: Gibt es bereits einen offenen Branch oder PR zu diesem Issue? Ist bereits jemand zugewiesen (Claim aktiv, < 48 h)? → Dann übernehmen statt neu starten, oder stoppen.
4. WIP-Limit prüfen: Sind schon 2 Issues `In Progress`? → Stoppen und melden.
5. Issue sichtbar claimen: Assignee setzen, Project-Status `In Progress`, Kommentar: „Claimed by @account on Branch claude/<typ>-<thema>-<nr>".
6. Branch `claude/<typ>-<thema>-<issue-nr>` + eigenen Worktree erstellen.
7. Nach dem ersten Commit früh einen **Draft-PR** eröffnen (PR-Template).
8. Nur relevanten Kontext laden: Issue + betroffenes Modul + zugehörige Tests (Kontextladen Stufe 0–1).
9. Abschnitt **Arbeitsstand** im PR ausfüllen (Ziel, Nicht-Ziele, nächster kleinster Schritt) und die **Plan-Pflicht** beantworten – trifft ein Auslöser zu (SYSTEM.md §4), erst das Impact Manifest, dann Code.

## Grenzen

- Keine Umsetzung ohne `ready`-Issue – der Skill erfindet keine Aufgaben.
- Keine vollständige Architekturrecherche, keine langen Zusammenfassungen.
- Keine Cloud-/Infrastrukturänderungen.
- Bei sicherheits-, daten- oder architekturrelevanten Überraschungen: `decision-needed` an den Orchestrator.

## Ergebnis

Kurze Meldung: Issue, Branch, Worktree-Pfad, Draft-PR-Link, 5-Punkte-Plan.
