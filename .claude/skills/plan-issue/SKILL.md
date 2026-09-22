---
name: plan-issue
description: Übersetzt eine Idee des Orchestrators in einen umsetzbaren Issue-Entwurf mit Scope und Testplan. Verwenden bei "Mach daraus ein Issue", "Plane dieses Feature" oder wenn eine vage Idee strukturiert werden soll. Erfindet nie Aufgaben und entscheidet nie Priorität.
---

# /plan-issue – Idee → Arbeitsvertrag

## Ablauf

1. Idee entgegennehmen (ein Satz reicht als Input).
2. Betroffene Module über die Architekturkarte identifizieren (nur relevante Zeilen lesen); ähnliche offene oder gemergte Issues suchen – Doppelarbeit ist ein Befund, kein neues Issue.
3. Issue-Entwurf nach `.github/ISSUE_TEMPLATE/feature.md` erstellen.

## Output

- Problem/Nutzen (1–3 Sätze)
- Akzeptanzkriterien (testbar formuliert)
- Nicht-Ziele
- Betroffene Module + Abhängigkeiten
- Testplan (Kriterium → Prüfart)
- **Offene Entscheidungen für den Orchestrator** (z. B. „Jeder Nutzer oder nur Admin?")
- Einschätzung: Security-/Profil-Auswirkung? Architekturfrage (→ /architecture-decision)?

## Grenzen

- Der Entwurf bleibt Entwurf: **Der Mensch bestätigt Priorität, Scope und setzt `ready`** – nie der Skill.
- Keine Implementierung, keine Branch-Erstellung (das macht /start-work nach `ready`).
- Bei unklarem Problem: Rückfragen stellen statt Annahmen erfinden.
