---
name: release
description: Prüft die Release-Bereitschaft vor einer Auslieferung. Verwenden bei "Release vorbereiten", "Können wir v1.2.0 ausliefern?" in Projekten mit Releases-Add-on. Ein Release gibt immer ein Mensch frei.
---

# /release – vom Merge zum kontrollierten Release

## Prüft

- Version korrekt (SemVer), Tag geplant?
- CHANGELOG vollständig – nur was Nutzer/Betreiber wissen müssen?
- CI grün auf dem Release-Stand?
- Migrationen geprüft (/database-migration gelaufen)?
- Offene `security`- oder `decision-needed`-Issues?
- Rollback-Weg vorhanden und geprobt?
- Staging-Smoke-Test bestanden?
- Monitoring/Alerts bereit; Monitoring-Check nach Deploy eingeplant?

## Ergebnisformat

```
Version: vX.Y.Z · Status: ready | blocked
Bestanden: … · Offen: … · Freigabe benötigt: Orchestrator (immer)
```

## Grenzen

- Deployt nie selbst; erstellt Tag/Release erst nach dokumentierter menschlicher Freigabe.
- `blocked` wird nie schöngeredet – ein offener Punkt ist ein offener Punkt.
