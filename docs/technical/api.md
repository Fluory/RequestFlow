# HTTP interfaces – RequestFlow

> The interface is a promise (`.claude/rules/api.md`): change this file or the OpenAPI contract in the
> same PR as the code. Machine-readable contracts live in `contracts/` (AI service, ERP export).

## `GET /api/health` (public, unauthenticated)

| Status | Body |
|---|---|
| 200 | `{"status":"ok","checks":{"database":"ok","storage":"ok"}}` |
| 503 | `{"status":"degraded","checks":{"<name>":"failed", …}}` – names only, never hosts, users or error text |
| 503 | `{"status":"degraded","checks":{"config":"failed"}}` – invalid configuration (the server log names the variables) |

- Each check has a 3 s time limit; `cache-control: no-store`.
- Cost per call: one `select 1` and one S3 `HeadBucket`. No rate limit in the pilot (local runtime,
  no public exposure); before any public deployment a rate limit or a short cache goes in front of it
  (showcase epic #19).
- Checks are added additively (queue backlog and AI service follow with #28); clients must ignore
  unknown check names.

## `POST /api/requests` (session required)

Multipart form, field `files` (1–`UPLOAD_MAX_FILES` files, each ≤ `UPLOAD_MAX_FILE_BYTES`, whole request
≤ `UPLOAD_MAX_REQUEST_BYTES`, `Content-Length` required). Allowed: `.eml .msg .pdf .xlsx .docx`, checked
by extension **and** content: signature for all; for `.xlsx/.docx` also the package structure (no
macros, no foreign ZIPs, declared size/entry limits). `.msg` is checked by its OLE signature only.

| Status | Body |
|---|---|
| 201 | `{"requestId": uuid, "possibleDuplicate": bool, "duplicateOfId": uuid \| null}` |
| 401 / 403 | `{"error":{"title":"…"}}` – not signed in / role |
| 411 | no numeric `Content-Length` (the body is bounded before it is read) |
| 413 | declared body larger than `UPLOAD_MAX_REQUEST_BYTES` |
| 422 | `{"error":{"title":"Dateityp nicht erlaubt: …"}}` – user-facing reason |
| 500 | generic message; details only as IDs in the log |

Request (NEW), documents, audit event and the `request-process` job commit in one transaction.
Duplicates: same `Message-ID` (read from `.eml` only – `.msg` Message-ID extraction is a follow-up)
or the same set of file hashes within the company; checks are serialised per company.

## `POST /api/erp-mock/v1/quote-requests` (ERP mock, only with `ERP_MOCK_ENABLED=true`)

The simulated ERP of the pilot (ADR-0001 D9) – contract `contracts/erp-export.openapi.yaml`. Without the
flag or without `ERP_TOKEN` the route answers 404. `Authorization: Bearer <ERP_TOKEN>`, header
`Idempotency-Key: <requestId>` (UUID, must equal `requestId` in the body), JSON body ≤ 64 KiB with a
`Content-Length` (411/413 otherwise).

| Status | Meaning |
|---|---|
| 201 | stored; body `{ erpReference, requestId, receivedAt }` |
| 200 | replay of a known key with the same body – the **same** `erpReference` |
| 400 / 401 | invalid key or body / wrong token |
| 409 | known key, different body – nothing stored |
| 503 | injected fault (`ERP_MOCK_FAULTS`) or the in-memory store is full (10 000 records) |

Keys live in the web process's memory (decision-needed in #9): a restart forgets them, and only one
web instance may serve the mock. Consequence: a restart between a stored-but-unanswered call and its
retry creates a second mock record – exactly-once on our side (unique export row) is unaffected.

## `GET /api/documents/:id` (session required)

Streams the original as `attachment` with `x-content-type-options: nosniff` and `cache-control: private,
no-store`. A document of another company answers 404 like a missing one; no session → 401.
