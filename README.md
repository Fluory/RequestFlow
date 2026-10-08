# RequestFlow

AI-assisted intake of quote requests for industrial sales teams: extract structured data from
e-mails and PDF/Excel/Word attachments, review every value **beside its source**, and export each
approved request **exactly once** to an ERP.

> **Status:** pilot scope built and released as [v0.1.0](https://github.com/Fluory/RequestFlow/releases/tag/v0.1.0)
> (2026-09-28); acceptance pending ([roadmap](docs/product/roadmap.md), M2). A synthetic showcase runs on Vercel
> for invited visitors.
> **Reference project:** built like a real customer engagement for a mid-sized machine-building
> company; the customer is fictional and **all data in this repository is synthetic**.

## What it does (pilot scope)

```text
upload (.eml/.msg/PDF/XLSX/DOCX) → parse → extract with evidence → verify grounding
  → review & correct beside the source → approve / reject → idempotent export to the ERP (mock)
```

- **No invented data:** the model must quote its source; a deterministic verifier checks that the
  quote exists in the cited segment – otherwise the value is flagged for review.
- **Nothing lost, nothing doubled:** jobs are enqueued in the same database transaction as the
  status change; the export uses an idempotency key, a unique export record and a row lock.
- **Tenant isolation:** repository scoping plus forced PostgreSQL row-level security per company.
- **Measurable AI quality:** an eval set with per-field metrics gates prompt and model changes.

## What runs today

Each line is a merged PR; details in the [CHANGELOG](CHANGELOG.md).

- Invite-only login, companies, user and role management for admins; forced row-level security on every
  company-data table (schema `app`), guarded by a test (#31, #37, #38)
- Upload of `.eml`, `.msg`, PDF (scanned pages via OCR when `AI_PDF_OCR=auto`, marked as such), XLSX and DOCX,
  several files per request; duplicates flagged and decided in the UI (#32, #40, #44)
- AI extraction of the header fields and line items with a grounding verifier (#33, #39)
- Review beside the source with a status per value, audited corrections, approve or reject (#35, #42)
- Exactly-once export of the reviewed values and positions to the ERP mock (#36, #54)
- Request list led by the next action, with diagnosis, retries and reprocessing, paged (#43, #58, #95)
- Eval set of 15 synthetic cases as a CI gate (#41); correlated structured logs and health (#45, #56, #88)
- Showcase: prepared sample requests replayed from recorded AI answers (#83)

## Architecture

TypeScript modular monolith (Next.js, Node 24, Drizzle, PostgreSQL 17, pg-boss, Better Auth,
S3 API) plus a stateless Python AI service (FastAPI, docling, Gemini on Vertex AI in the EU; the showcase
uses the Gemini API free tier with synthetic data only – a dated exception, ADR-0001 D11).
Rationale, alternatives and trade-offs: [ADR-0001](docs/decisions/ADR-0001-pilot-architecture.md).

## Documentation map

| Topic | Where |
|---|---|
| Architecture map and exceptions register | [docs/technical/architecture.md](docs/technical/architecture.md) |
| Decisions | [docs/decisions/](docs/decisions/INDEX.md) |
| Project brief, roadmap | [docs/product/](docs/product/project-brief.md) |
| Evidence: measured figures (synthetic) | [docs/product/evidence.md](docs/product/evidence.md) |
| Customer proposal (German) | [docs/product/pilot-vorschlag.md](docs/product/pilot-vorschlag.md) |
| Discovery and approvals (German) | [PROJECT-START.md](PROJECT-START.md) |
| Working rules for humans and agents | [AGENTS.md](AGENTS.md) |

## Getting started

Requirements: Docker, Node 24 with corepack (`corepack enable` → pnpm 9.15.9).

```bash
cp .env.example .env            # optional – the defaults are local, synthetic-data-only values
docker compose up --build       # postgres, storage, setup (migrations + bucket), web, worker
curl localhost:3000/api/health  # {"status":"ok","checks":{"database":"ok","storage":"ok"}}
```

Developing against local services only:

```bash
pnpm install
docker compose up -d postgres storage
pnpm setup:deploy               # migrations as app_owner + bucket (needs the .env.example variables)
pnpm dev
pnpm verify                     # lint, types, unit + integration tests, architecture check, build, audit
```

## How this repository is run

Every change starts as an issue, lands through a pull request with a plain-language summary and a
green CI, and is never merged by its author. The process follows the fluory-system rulebook
(guard hooks in `.claude/`, docs and PR guards in `scripts/`).

## Kurzfassung (Deutsch)

KI-gestützte Erfassung von Angebotsanfragen: Daten aus E-Mails und Anhängen extrahieren, jede
Angabe neben ihrer Fundstelle prüfen und freigegebene Anfragen genau einmal ans ERP übergeben.
Referenzprojekt mit fiktivem Kunden – alle Daten sind synthetisch.
