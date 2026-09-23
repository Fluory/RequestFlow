# Changelog – RequestFlow

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Newest entry on top.
This file records what changes **in the product** – process and session state live in the PR plain-language section.

## [Unreleased]

### Added
- Invite-only login (e-mail + password): admins invite staff into their own company; sign-up
  without an invitation creates no account. Roles `admin` and `clerk` per company.
- Tenant isolation: every company-owned table has forced row-level security; data access runs
  inside `withTenant()`.
- Login rate limit (stored in the database) and `pnpm seed:demo` with two synthetic companies.
- Runnable local stack: `docker compose up` starts PostgreSQL 17, SeaweedFS (S3), a one-shot `setup`
  step (migrations + private bucket), the web app and a no-op worker.
- `GET /api/health` reports database and storage status (200 / 503, no connection details).
- Database roles `app_owner` (migrations) and `app_rw` (runtime, no RLS bypass); schema `app`.
- Verify commands `pnpm verify:changed`, `pnpm verify`, `pnpm verify:full`; CI runs integration
  tests against real PostgreSQL + SeaweedFS.
