# Changelog – RequestFlow

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Newest entry on top.
This file records what changes **in the product** – process and session state live in the PR plain-language section.

## [Unreleased]

### Added
- Observability: structured JSON logs (pino) with IDs and codes only, correlated by the request id from web
  through worker to the AI service; `/api/health` also shows whether the AI service is reachable and how
  many jobs are waiting.
- Duplicate handling: a possible duplicate shows a banner with the original; the clerk confirms it as a
  separate request or rejects it as a duplicate (reason stored, audited). A possible duplicate cannot be
  approved before that decision, and a rejected one can never be exported.
- Request list (`/requests`): attempts, the last error with its stage (processing or export) and the next
  retry per request, filters for status and possible duplicates, and "Erneut verarbeiten" for failed requests.
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
