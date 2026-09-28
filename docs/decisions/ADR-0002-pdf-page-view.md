# ADR-0002 · Original PDF page in the review screen: pdf.js in the browser

- **Status:** Accepted – decided by the orchestrator on 2026-09-28 in #74
- **Date:** 2026-09-28
- **Context issue:** #74 (showcase review 2026-09-27, P1 item 2; epic #19)
- **Relates to:** ADR-0001 D5 (originals only through the tenant-checked route), D8 (grounding, stored bounding boxes)

## Context

The review screen shows a value's source as text in reading order with the cited segment marked
(#8, #25). For PDFs the AI service already stores the cited segment's page and bounding box
(`PdfLocator.bbox`, PDF points, origin top-left); #8 left the rendered view as "decision needed".
The showcase review asked for the original page beside the values so a visitor sees within a minute
that every value can be checked against the original.

Constraints: originals are read only through `GET /api/documents/:id` (tenant-checked, private
bucket, no public URLs); no third-party requests from the review screen; the AI service stays
stateless and never gets storage credentials (D8); the web app runs on Vercel Hobby (D11).

## Options

| Option | + | − |
|---|---|---|
| **A · pdf.js (`pdfjs-dist`) in the browser** | renders the exact original from the existing route; bbox → overlay is a percentage of the page; no server cost; Apache-2.0; widely used, maintained by Mozilla | new dependency (~35 MB unpacked in `node_modules`, the page loads it lazily); a worker file must be served by the app |
| B · server-side page image (pdfium in the AI service or a Node renderer) | no PDF code in the browser | the AI service would need the original bytes again per view or storage access (breaks D8 statelessness) or the web runtime needs a native renderer; extra CPU per page view; images must be cached and tenant-scoped |
| C · the browser's own PDF viewer (`<iframe>` / `#page=`) | no dependency | no reliable way to highlight a region; the route answers `content-disposition: attachment`; viewer differs per browser |

## Decision

**Option A.** The review page loads `pdfjs-dist` lazily in a client component, fetches the original
through `GET /api/documents/:id` (same origin, the session cookie – no new route, no public URL),
renders the cited page to a canvas and lays the stored bounding box over it as a percentage of the
page size. The pdf.js worker is served from the app's own build output (`new URL(…, import.meta.url)`),
never from a CDN. XFA forms stay off; pdf.js 6 evaluates no code from a PDF (no `eval` or
`new Function` in the build) and its scripting sandbox is never loaded. The text source view stays below the page: it is the
accessible equivalent of the canvas, and the only view for mail, XLSX, DOCX and PDFs inside an
Outlook message (the route serves the `.msg`, not the attachment).

Verified: docling's boxes are in the displayed page's space – for a page with `/Rotate 90` they are
already rotated – so the default pdf.js viewport (which applies `/Rotate`) needs no extra rotation.

## Consequences

- One new runtime dependency, pinned; `pnpm audit` covers it in `verify`.
- The review page's JavaScript grows only when a PDF source is shown (dynamic import).
- A PDF the renderer cannot open falls back to the text view with a note – the review never depends on it.

## Re-evaluate when

- a customer needs PDFs inside `.msg` attachments rendered (needs an attachment download route), or
- a strict Content-Security-Policy is introduced (worker and canvas rules), or
- `pdfjs-dist` has an unpatched advisory that `pnpm audit` reports.
