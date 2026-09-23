# Changelog – RequestFlow

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Newest entry on top.
This file records what changes **in the product** – process and session state live in the PR plain-language section.

## [Unreleased]

### Added
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
