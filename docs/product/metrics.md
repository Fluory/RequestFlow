# Metrics – success signals for the pilot (M2)

> Issue #113. Derived from [project brief → Success](project-brief.md#success-measurable) and the acceptance
> criteria of the proposal ([`pilot-vorschlag.md` §7](pilot-vorschlag.md#7-abnahmekriterien-vorschlag--zielwerte-legen-wir-im-kickoff-fest)).
> The proposal sets **no** target values – they are agreed at kickoff. Until then every target here reads
> "to be set at kickoff"; nothing is estimated. Measured figures so far: [evidence](evidence.md).

## Signals

| # | Signal | Target | Source | Read | Measurable today? |
|---|---|---|---|---|---|
| S1 | Header fields correct without correction | to be set at kickoff (per key field) | DB: `extracted_fields` (latest run) vs. `field_corrections`; eval gate for the replay view | weekly in the pilot | **yes** – no pilot data yet (no real users) |
| S2 | Handling time per request, with app vs. today | to be set at kickoff (baseline first) | protocol: who, which request, start/end, with and without the app | once at baseline, then every 2 weeks | **no** – protocol not defined yet ([evidence §3](evidence.md#3-handling-time)) |
| S3 | Export failures per week; double exports | double exports: **0** (§7, structural); failures: to be set at kickoff | audit `request.failed` with `data.stage = 'export'`; `request_exports` unique per request | weekly | **yes** |
| S4 | Model cost per request | to be set at kickoff; monthly limit from #109 | `extraction_runs.total_tokens` × list price of the model | monthly | **tokens yes, € no** – the price basis is open (#109) |
| S5 | p95 time from upload to "ready for review" | to be set at kickoff | `requests.created_at` → audit `request.extracted`; AI share in `extraction_runs.latency_ms` | weekly | **yes** |

What the signals do not replace: "no value is *found* without verified evidence" and "no data of another
company" (§7) are enforced by a database check, the grounding verifier and the integration tests on every
PR – they are pass/fail guarantees, not trends, so they are not tracked here.

## How each signal is measured

All queries are read-only and run **per company** in its tenant context, like the app: as `app_rw`
inside a transaction with `set_config('app.company_id', '<company id>', true)` (forced row-level security,
[ADR-0001 D7](../decisions/ADR-0001-pilot-architecture.md#d7--authorization-and-tenant-isolation--challenged-application-level-vs-rls)).
They return counts and durations only – no document content, no personal data. Sample requests
(`source = 'sample'`) are excluded – for the M2 acceptance walk on the showcase, which uses only the
synthetic samples, drop the `source` filter. `:from` / `:to` bound the reporting period.

### S1 – Header fields correct without correction

Share of header fields that the model marked `found` in the latest run and that nobody corrected before
approval, per key field. A correction counts only if it changed the value (a save with the same value does
not); it means the clerk changed the value – so a `found` value was wrong or
incomplete. Only approved or exported requests count (the review is finished).

```sql
WITH latest AS (
  SELECT DISTINCT ON (request_id) id, request_id
  FROM app.extraction_runs ORDER BY request_id, created_at DESC
)
SELECT f.field_key,
       count(*) AS found,
       round(100.0 * count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM app.field_corrections c
         WHERE c.request_id = f.request_id AND c.field_key = f.field_key AND c.item_index IS NULL
           AND c.new_value IS DISTINCT FROM f.value
       )) / count(*), 1) AS correct_without_correction_pct
FROM app.extracted_fields f
JOIN latest l ON l.id = f.run_id
JOIN app.requests r ON r.id = f.request_id
WHERE f.item_index IS NULL AND f.status = 'found'
  AND r.status IN ('APPROVED', 'EXPORTED') AND r.source = 'upload'
  AND r.created_at >= :from AND r.created_at < :to
GROUP BY f.field_key ORDER BY f.field_key;
```

The replay view of the same question is the eval gate (`pnpm evals`, `found_accuracy` per key field) – it
measures the pipeline on 15 synthetic cases, not a live model ([evidence §1](evidence.md#1-extraction-quality-per-key-field-eval-gate)).

### S2 – Handling time per request

Not measurable from the system: the app sees when a request was uploaded and approved, not how long a
person worked on it. Before the pilot starts, the orchestrator and the customer agree a protocol – per
request: clerk, request reference, start and end time, with or without the app – and record a baseline
from today's process. Until then no time saving is claimed.

### S3 – Export failures and double exports

A failure is a request that ended in `ERROR` at the export stage after all retries (audit `request.failed`,
written once per final failure). A request that is reprocessed by hand and fails again is one request
with two failure events – the query reports both. A double export cannot be stored: `request_exports` has one row per
request (unique `request_id`) and the export runs under a row lock with an idempotency key
([ADR-0001 D9](../decisions/ADR-0001-pilot-architecture.md#d9--external-integrations)), proven by the
integration tests on every PR. The second query is the cross-check – it must return 0.

```sql
SELECT date_trunc('week', a.created_at) AS week,
       count(DISTINCT a.entity_id) AS requests_with_export_failure, count(*) AS failure_events
FROM app.audit_events a JOIN app.requests r ON r.id = a.entity_id
WHERE a.action = 'request.failed' AND a.data->>'stage' = 'export' AND r.source = 'upload'
  AND a.created_at >= :from AND a.created_at < :to
GROUP BY 1 ORDER BY 1;

SELECT count(*) AS requests_exported_more_than_once
FROM (SELECT a.entity_id FROM app.audit_events a JOIN app.requests r ON r.id = a.entity_id
      WHERE a.action = 'request.exported' AND r.source = 'upload'
      GROUP BY a.entity_id HAVING count(*) > 1) AS d;
```

### S4 – Model cost per request

Tokens per request are recorded (sum over all runs, reprocessing included). Cost = tokens × list price of
the model at that date; the price basis, its date and the monthly limit are defined in #109 – until then
this signal reports tokens only.

```sql
SELECT count(*) AS requests,
       round(avg(tokens)) AS avg_tokens_per_request,
       max(tokens) AS max_tokens_per_request
FROM (SELECT ru.request_id, sum(ru.total_tokens) AS tokens
      FROM app.extraction_runs ru JOIN app.requests r ON r.id = ru.request_id
      WHERE r.source = 'upload' AND r.created_at >= :from AND r.created_at < :to
      GROUP BY ru.request_id) AS t;
```

### S5 – p95 time from upload to "ready for review"

From the upload (`requests.created_at`) to the first successful extraction (audit `request.extracted`):
queue wait, retries and the AI call together. `extraction_runs.latency_ms` is the AI service's share.
Requests that never reached review (processing `ERROR`) have no end point and are not in the p95 – read
them from S3's sibling: `count(*)` of `request.failed` with `data->>'stage' = 'processing'`.

```sql
SELECT count(*) AS requests,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM e.first_extracted - r.created_at))
         AS p95_upload_to_review_s
FROM app.requests r
JOIN (SELECT entity_id, min(created_at) AS first_extracted FROM app.audit_events
      WHERE action = 'request.extracted' GROUP BY entity_id) e ON e.entity_id = r.id
WHERE r.source = 'upload' AND r.created_at >= :from AND r.created_at < :to;

SELECT count(*) AS runs,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY ru.latency_ms) / 1000.0 AS p95_ai_latency_s
FROM app.extraction_runs ru JOIN app.requests r ON r.id = ru.request_id
WHERE ru.latency_ms IS NOT NULL
  AND r.source = 'upload' AND r.created_at >= :from AND r.created_at < :to;
```

## Reading and reporting

- **Who:** the orchestrator, during the pilot (M2); the figures go into the pilot acceptance record.
- **Where:** the queries above, run against the pilot database per company; results are copied as
  aggregates (counts, percentages, seconds) – never row data.
- **Verified:** all six queries ran on 2026-10-15 against a database built from the migrations up to
  `0019_request_source_check.sql` (local PostgreSQL 16 – the stack runs 17, the queries use nothing version-specific – as `app_rw` with
the tenant context set), seeded with
  synthetic rows for two companies; each returned the expected value – the second company's rows, sample
  requests and fields of an older run were excluded. The queries have no automated test: after a
schema change to these tables, run them again.
