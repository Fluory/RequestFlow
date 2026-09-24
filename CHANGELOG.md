# Changelog – RequestFlow

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Newest entry on top.
This file records what changes **in the product** – process and session state live in the PR plain-language section.

## [Unreleased]

### Added
- ERP export sends the reviewed positions (description, quantity, unit, material, dimensions) with each
  approved request – ERP contract 1.1.0, additive and optional. A position value the ERP would refuse
  blocks the approval so the clerk can still correct it.
- Visual design for the pilot UI, implemented from the Claude Design prototype "RequestFlow A": warm
  neutral palette with one blue accent, IBM Plex Sans/Mono (self-hosted via `@fontsource`, no
  third-party requests), a header with company, name and role, a start page with open work, and a
  two-column review page – fields, positions and documents on the left, the selected value with its
  source and the decision in a sticky panel on the right. Status is always labelled (⚠ for values that
  need attention); colours are design tokens (WCAG AA). Login and upload errors are announced as alerts;
  after an upload the message links to the new request; invitation links can be copied.
- Observability: structured JSON logs (pino) with IDs and codes only, correlated by the request id from web
  through worker to the AI service; `/api/health` also shows whether the AI service is reachable and how
  many jobs are waiting.
- Duplicate handling: a possible duplicate shows a banner with the original; the clerk confirms it as a
  separate request or rejects it as a duplicate (reason stored, audited). A possible duplicate cannot be
  approved before that decision, and a rejected one can never be exported.
- Request list (`/requests`): attempts, the last error with its stage (processing or export) and the next
  retry per request, filters for status and possible duplicates, and "Erneut verarbeiten" for failed requests.
- Review of line items: positions appear as a table with a status per field; each field opens its source
  (mail line, PDF page – marked when it comes from text recognition –, Excel cell, Word paragraph or table
  cell) and can be corrected, audited like header fields.
- AI eval set and gate: 15 synthetic cases (tables, scans, missing values, prompt injection) measure
  extraction quality per field; every change to the AI service is checked against a committed
  baseline and fails when a field gets worse by more than 5 points or an injected value is accepted.
- More document formats: Outlook `.msg` (with attachments, parsed recursively), Excel `.xlsx` and Word
  `.docx` are extracted with exact source positions; scanned PDFs can be read with OCR – such values are
  at most "uncertain". A broken attachment no longer fails the whole request.
- Extraction schema v2: e-mail, phone and additional requirements as header fields, plus line items
  (description, quantity, unit, material, dimensions), each with its own status and source quote; German
  number formats, units and dates are normalised, a bare calendar week ("KW 42") stays at most uncertain.
- User management for admins (`/users`): see the company's users with role and status, change roles,
  deactivate (sign-in blocked, sessions ended) and reactivate; invitations and every change are audited.
  The last active admin of a company cannot be demoted or deactivated; clerks have no access.
- Guard for tenant isolation: the build fails when a table with company data lacks enforced
  row-level security or its company policy.
- Export: approved requests are sent to the ERP (a simulated ERP in the pilot, contract
  `contracts/erp-export.openapi.yaml`) exactly once – retries after errors or lost answers never create a
  second record; the request page shows the ERP reference, running retries, and a visible error if the
  export finally fails (reprocess possible). The ERP mock is off unless `ERP_MOCK_ENABLED=true`.
- Review (`/requests/:id`): staff see each extracted field with its status (found, uncertain,
  missing, not verified) beside the source passage, correct values (every correction is kept with
  who and when), approve the request – which queues it for export – or reject it with a reason.
- `pnpm verify:full` runs a browser smoke flow (upload → processing → review → correction → approval).
- Background processing: the worker sends each document to the AI service, stores the extracted
  fields with their evidence and moves the request to review; failures retry with backoff and end
  in a visible error with attempts and cause; failed requests can be reprocessed.
- AI service (`services/ai`): `POST /v1/extract` turns an e-mail or PDF into segments with stable
  locators and extracts company, contact person and requested delivery date with evidence; a
  deterministic verifier marks every value whose quote is not in the cited segment as `unverified`.
- Upload of a quote request (`/requests`): .eml, .msg, .pdf, .xlsx, .docx up to a configured size;
  originals stored privately, download only for the own company. Request, documents, audit entry and
  the processing job are created in one step; exact duplicates are flagged and linked.
- Invite-only login (e-mail + password): admins invite staff into their own company and hand over
  an invitation link; sign-up without a valid invitation link creates no account. Roles `admin` and `clerk` per company.
- Tenant isolation: every company-owned table has forced row-level security; data access runs
  inside `withTenant()`.
- Login rate limit (stored in the database) and `pnpm seed:demo` with two synthetic companies.
- Runnable local stack: `docker compose up` starts PostgreSQL 17, SeaweedFS (S3), a one-shot `setup`
  step (migrations + private bucket), the web app and a no-op worker.
- `GET /api/health` reports database and storage status (200 / 503, no connection details).
- Database roles `app_owner` (migrations) and `app_rw` (runtime, no RLS bypass); schema `app`.
- Verify commands `pnpm verify:changed`, `pnpm verify`, `pnpm verify:full`; CI runs integration
  tests against real PostgreSQL + SeaweedFS.
- Request list pages by 50 (keyset on creation time and id, stable while new requests arrive):
  "Ältere Anfragen" / "Zurück zum Anfang" keep the filters; an invalid page parameter shows page 1.

### Changed
- AI service logs use the web/worker format: `time` (ISO 8601, `Z`) instead of `ts`, lower-case pino level labels (`warn`, not `WARNING`), `logger` only on library records.

### Fixed
- AI verifier: a unit quoted together with the neighbouring table cell (e.g. `60    | Stk.`) is now
  confirmed as `found` when one cell of the quote is exactly the unit; quotes that differ from the
  source in real characters are still rejected (#50).
- The database refuses a line-item correction with a negative position, like it already does for
  extracted values – defence in depth below the review check (#47).

### Changed
- The request list reads each page from an index in its sort order instead of sorting all of the
  company's requests (#61).
