# AGENTS.md – RequestFlow

RequestFlow turns quote requests (e-mail + PDF/Excel/Word attachments) into reviewed, source-linked
structured data and exports each approved request exactly once to an ERP. Reference project, treated
as a real customer engagement for a mid-sized machine-building company. **All data is synthetic.**

> Project card: keep it under ~100 lines (hard limit 200 – `scripts/doku-check.sh`). Full rulebook:
> https://github.com/fluory/entwicklungsplan/blob/main/SYSTEM.md · Profile: `project-profile.yml`
> (stage P1 + add-ons) · Area rules: `.claude/rules/` (load only when matching files are read).

## Commands & proof

> **Foundation phase:** there is no product code yet. Until the first code issue lands, `verify` is
> `bash scripts/doku-check.sh`. The commands below are the agreed targets; the first code issue
> creates them and removes this note.

- Setup: `pnpm install && uv sync --project services/ai` · Start: `docker compose up`
- `verify:changed` – inner loop: format, typecheck, focused tests of the touched files. `pnpm verify:changed -- <path>` · AI service: `uv run --project services/ai pytest <path>`
- `verify` – canonical PR proof: lint, types, relevant tests, architecture check (dependency-cruiser), build, `pnpm audit`, plus ruff/pyright/pytest for `services/ai`. `pnpm verify` A PR is not `ready-for-review` while verify fails, cannot run, or the exception is not justified in the PR.
- `verify:full` – integration against Postgres + object storage, Playwright smoke flow, AI eval gate. `pnpm verify:full` – before a release, after risky refactors or with PR label `verify-full`.
- Test and verify output is trimmed automatically (`scripts/quiet-run.sh` via the hook `filter-test-output.sh`): exit code unchanged, full log path printed; prefix `FLUORY_FULL_OUTPUT=1` once when the cause is unclear.
- **Docs guard:** `scripts/doku-check.sh` – runs in CI and in `/finish-work`.

## Technical defaults

System-wide decisions: `Entwicklungsplan/STACK-DEFAULTS.md`. Project choice (ADR-0001, accepted
2026-09-22): TypeScript modular monolith (Next.js App Router, Node 24, Drizzle, PostgreSQL 17,
pg-boss, Better Auth, S3 API) + stateless Python 3.13 AI service (FastAPI, docling, Vertex AI `eu`).
Deviations from the orchestrator's personal defaults (Supabase, Vercel as primary runtime): see
`docs/decisions/ADR-0001-pilot-architecture.md` D3, D6, D11.

## Rules (short form)

<!-- Do not rename this heading: .claude/hooks/session-start.sh re-injects exactly this section
     at every start, resume and after every context compaction. -->

1. `main` only via PR. Work only with an issue + branch `claude/<type>-<topic>-<issue-nr>` + draft PR.
2. Claim the issue: assign + comment "Claimed by @account on branch …" + draft PR within ~1 h. Stale claims (48 h without push) go back to Ready. Max. 2 issues `In Progress` per project.
3. Acceptance criteria or spec first, then test, then code. Verify green before ready-for-review.
   **Stuck protocol:** hypothesis → focused check; failed → document result and cause; a second attempt only with a changed hypothesis; after two failures reset (`/rewind` and/or git), update the draft PR, set `blocked`, ask a precise question. Never weaken, delete or bypass tests to get green.
4. Docs only for long-lived knowledge – but in the same PR. Every PR has the plain-language section „Was ist passiert (Klartext)".
5. Never merge your own PR – reviewer role, preferably the other account (checklist: Entwicklungsplan/templates/review-checkliste.md).
6. New files belong to a module of the architecture map – otherwise update the map first.
7. No secrets in code, logs or repo. Remove the worktree once everything is pushed and a PR exists (or the work was consciously discarded); with an open draft PR it may stay – it is always replaceable.
8. Guards (`.claude/settings.json`): push to `main`/`master`, force-push and `--no-verify` are blocked; the stop check demands a safe state before the end. False alarm → issue in the control center, never disable or bypass a hook.
9. Load context in stages and navigate from the precise signal to the broad one (see below); never read whole folders, logs or history without a concrete reason.
10. Git checkpoint before risky operations (migration, generator, dependency upgrade, file moves, mass edits, discarding changes): commit or stash first – `/rewind` is no substitute for git. Before a new shared utility, adapter, validator or service: search for existing functionality and state it in the PR.
11. Language: technical artefacts are English by default (code, identifiers, this card, rules, ADRs, technical docs, commit messages, PR titles; issue titles and acceptance criteria in public projects). User-facing, customer and legal texts follow their audience. Never maintain a technical rule in two languages; existing German text is translated at its next substantive edit, never in a bulk refactor.

## Context routing (read first, not in advance)

| Topic | Read first |
|---|---|
| Architecture / modules / exceptions register | `docs/technical/architecture.md` |
| Decisions | `docs/decisions/INDEX.md` → the one ADR you need |
| Product scope, milestones, customer proposal | `docs/product/project-brief.md`, `docs/product/roadmap.md` |
| Discovery (why this project exists, approvals) | `PROJECT-START.md` – only for scope questions |
| Current work | open draft PRs + issues |
| Files provided by the human (customer request, samples) | `docs/input/` – only those linked from the issue |
| Rules for one area (API, migrations, infra, security, AI/RAG, tests, E2E) | `.claude/rules/<area>.md` – loaded automatically when you read matching files; do not copy them here |

## Navigation ladder

1. Issue and current PR diff → 2. affected test file → 3. directly imported implementation → 4. LSP: definition, references, type, call hierarchy → 5. targeted text search → 6. public interface of the neighbouring module → 7. ADR, architecture map, old PRs or logs → 8. broad repository exploration, only last.
Where a symbol is defined or used: LSP before text search. What a feature changed: `git diff` or the PR diff. Which boundary applies: architecture map, area rule, ADR. Unknown failure: a read-only scout with a narrow brief.

## Reading rule

Stages: this card + issue → PR diff + module + tests → neighbouring interface → history only on concrete occasion. Delegate mass reading to a read-only scout: state what to find, max. 12 files, per finding path + line range + role in one sentence, no whole files, no summary of the whole project. Subagents use the smallest sufficient model for mechanical work (SYSTEM.md §8); the top model only for architecture, review and hard debugging.

## Skill register (load on demand – not everything up front)

Installed in `.claude/skills/` (core, always): **start-work · finish-work · review-pr · plan-issue**.
Others exist as templates in `Entwicklungsplan/templates/skills/` and are installed once their trigger occurs:
`project-start`/`project-plan`/`setup-project` (founding: discovery → plan → setup after approval) · `architecture-decision` · `legacy-audit` · `refactor-module` · `security-review` (from P1) ·
`ai-eval` (AI/RAG) · `database-migration` (DB) · `infra-change` (infra) · `observability`/`incident` (operations) ·
`cost-review` · `performance-check` · `release`/`release-notes` (releases) · `ui-feature`/`accessibility-review` (UI) ·
`api-contract` (API) · `reuse-scan`/`package-extract`/`make-universal` (reuse: find → decide → build, rule of three). Catalogue: `Entwicklungsplan/templates/skills/README.md`.
Expected early triggers here: `security-review`, `database-migration`, `ai-eval`, `api-contract`.

## Project specifics

- **Synthetic data only.** Public repo: never commit real mails, attachments, names or company data – not in fixtures, evals, issues or screenshots.
- **Tenant context is mandatory.** Every data access runs through a module repository inside `withTenant(companyId, …)`; `companyId` comes from the session, never from client input. No raw DB client outside `src/db` and `src/features/tenancy` (ADR-0001 D7).
- **The AI service is stateless.** It never gets DB or storage credentials or tenant logic; the TS worker sends bytes and persists results (D8). pg-boss is the only queue (D4).
- **"Found" needs proof.** A field is `found` only if the grounding verifier confirmed its quote in the cited segment; never relax this to make evals pass (D8).
- **Gemini free tier:** local development with synthetic data only – never in the showcase or with customer data (D8).
- **Exactly-once export** relies on the idempotency key + unique export row + row lock – keep all three (D9).
- Line endings: `.gitattributes` forces LF. Git Bash on Windows tolerates CRLF (tested 2026-09-22); LF keeps scripts portable to Linux shells (CI, WSL2, containers).
