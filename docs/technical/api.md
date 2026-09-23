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

Multipart form, field `files` (1–`UPLOAD_MAX_FILES` files, each ≤ `UPLOAD_MAX_FILE_BYTES`). Allowed:
`.eml .msg .pdf .xlsx .docx`, checked by extension **and** content signature.

| Status | Body |
|---|---|
| 201 | `{"requestId": uuid, "possibleDuplicate": bool, "duplicateOfId": uuid \| null}` |
| 401 / 403 | `{"error":{"title":"…"}}` – not signed in / role |
| 413 | declared body larger than files × size limit |
| 422 | `{"error":{"title":"Dateityp nicht erlaubt: …"}}` – user-facing reason |
| 500 | generic message; details only as IDs in the log |

Request (NEW), documents, audit event and the `request-process` job commit in one transaction.

## `GET /api/documents/:id` (session required)

Streams the original as `attachment` with `x-content-type-options: nosniff` and `cache-control: private,
no-store`. A document of another company answers 404 like a missing one; no session → 401.
