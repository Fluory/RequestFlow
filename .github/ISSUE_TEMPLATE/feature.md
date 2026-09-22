---
name: Feature / Aufgabe
about: Der Arbeitsvertrag zwischen Mensch und KI – ein Issue = ein Branch = ein PR
title: "<kurzes, sprechendes Thema>"
labels: feature
---

## Ziel

<1–3 Sätze: Was soll danach möglich sein, für wen?>

## Akzeptanzkriterien

<!-- Werden 1:1 zu Tests. -->
- [ ] <Wenn X, dann Y.>

## Nicht Teil dieser Aufgabe

- <bewusste Abgrenzung>

## Betroffene Bereiche

- `src/features/…`

## Testplan

<!-- Pro Akzeptanzkriterium: automatisierter Test, manueller Smoke-Test oder begründete Ausnahme. -->
| Kriterium | Prüfart |
|---|---|
| <…> | Unit-Test / Integrationstest / manueller Smoke-Test |

## Security/Privacy betroffen?

<Nur ausfüllen, wenn ja: Auth/Rechte · Personen-/Firmendaten · öffentlicher Endpoint ·
Upload/Download · Infra/DNS · KI/RAG-Aktion – dann nötige Maßnahme oder offene Frage benennen.>

<!-- Sprache: bei neuen öffentlichen Projekten Titel und Akzeptanzkriterien englisch (SYSTEM.md „Sprache und Portfolio").
     Ready-Kriterien (Definition of Ready, SYSTEM.md §4): Ziel klar, Akzeptanzkriterien da,
     Nicht-Ziele festgelegt, Abhängigkeiten bekannt, Testplan skizziert. Erst dann Label `ready`.
     Claim-Protokoll: zuweisen + Kommentar "Claimed by @account on Branch claude/…-<nr>"
     + Draft-PR binnen ~1 h. Stale nach 48 h ohne Push → zurück auf Ready oder blocked. -->
