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
