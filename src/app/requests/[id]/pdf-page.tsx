"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PageRegion } from "@/features/review";
import { overlayOf } from "./pdf-overlay";

// The original PDF page beside the values, with the cited box highlighted (#74, ADR-0002). pdf.js loads
// only here, in the browser, and only when a PDF source is shown. The original comes from the
// tenant-checked document route with the session cookie – no other request leaves the page. The text
// source view below stays the accessible equivalent of the canvas.

type Pdfjs = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;

let pdfjs: Promise<Pdfjs> | undefined;
function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= import("pdfjs-dist").then((module) => {
    // The worker is part of the app's own build output, never a CDN.
    module.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return module;
  });
  return pdfjs;
}

// One download per document while the page is open: choosing another value renders from memory.
const documents = new Map<string, Promise<PdfDocument>>();
function openDocument(documentId: string): Promise<PdfDocument> {
  let document = documents.get(documentId);
  if (!document) {
    document = loadPdfjs().then(async (module) => {
      const response = await fetch(`/api/documents/${documentId}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`document request failed: ${response.status}`);
      const data = new Uint8Array(await response.arrayBuffer());
      // No XFA forms; pdf.js 6 evaluates no code from a PDF, and its scripting sandbox is never loaded.
      return module.getDocument({ data, enableXfa: false }).promise;
    });
    document.catch(() => documents.delete(documentId));
    documents.set(documentId, document);
  }
  return document;
}

/** CSS pixels per PDF point in the magnified view: 10 pt text reads like 13 px. */
const MAGNIFIED = 1.35;

interface Outcome {
  key: string;
  /** Page size in PDF points (displayed page, i.e. after `/Rotate`); absent when rendering failed. */
  size?: { width: number; height: number };
}

export function PdfPage({ documentId, region, label }: { documentId: string; region: PageRegion; label: string }) {
  const captionId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const [wholePage, setWholePage] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const key = `${documentId}#${region.page}#${wholePage ? "page" : "magnified"}`;

  useEffect(() => {
    let cancelled = false;
    let task: { cancel(): void } | undefined;
    openDocument(documentId)
      .then((pdf) => pdf.getPage(region.page))
      .then(async (page) => {
        const target = canvas.current;
        const box = frame.current;
        if (cancelled || !target || !box) return;
        const size = page.getViewport({ scale: 1 });
        const scale = wholePage ? box.clientWidth / size.width : MAGNIFIED;
        // Drawn at device resolution, shown at CSS size: sharp on high-density screens.
        const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
        target.width = Math.floor(viewport.width);
        target.height = Math.floor(viewport.height);
        target.style.width = `${Math.floor(size.width * scale)}px`;
        target.style.height = `${Math.floor(size.height * scale)}px`;
        const rendering = page.render({ canvas: target, viewport });
        task = rendering;
        await rendering.promise;
        if (!cancelled) setOutcome({ key, size: { width: size.width, height: size.height } });
      })
      .catch(() => {
        if (!cancelled) setOutcome({ key });
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [documentId, region.page, wholePage, key]);

  const current = outcome?.key === key ? outcome : null;
  const state = current === null ? "loading" : current.size ? "rendered" : "failed";
  const overlay = current?.size ? overlayOf(region.bbox, current.size) : null;
  const overlayKey = overlay && `${key}:${overlay.left}:${overlay.top}:${overlay.width}:${overlay.height}`;

  // The cited place in the middle of the frame – the frame scrolls, never the page.
  useEffect(() => {
    const box = frame.current;
    const target = highlight.current;
    if (!overlayKey || !box || !target) return;
    box.scrollTo({ left: target.offsetLeft + target.offsetWidth / 2 - box.clientWidth / 2, top: target.offsetTop + target.offsetHeight / 2 - box.clientHeight / 2 });
  }, [overlayKey]);

  if (state === "failed") {
    return (
      <p className="field-hint" data-testid="pdf-page" data-state="failed">
        Die Originalseite lässt sich hier nicht anzeigen – die Fundstelle steht unten als Text.
      </p>
    );
  }
  return (
    <figure className="pdf-page" data-testid="pdf-page" data-state={state}>
      <div className="pdf-bar">
        <figcaption id={captionId}>Original, Seite {region.page}</figcaption>
        <button type="button" className="btn-small" aria-pressed={wholePage} onClick={() => setWholePage((value) => !value)}>
          Ganze Seite
        </button>
      </div>
      {/* Focusable, so the scrollable frame works by keyboard too. */}
      <div ref={frame} className={wholePage ? "pdf-frame whole" : "pdf-frame"} tabIndex={0} aria-labelledby={captionId}>
        <div className="pdf-sheet">
          <canvas ref={canvas} role="img" aria-label={label} />
          {overlay && (
            <div
              ref={highlight}
              className="pdf-highlight"
              data-testid="pdf-highlight"
              style={{ left: `${overlay.left}%`, top: `${overlay.top}%`, width: `${overlay.width}%`, height: `${overlay.height}%` }}
            />
          )}
        </div>
        {state === "loading" && (
          <p className="pdf-status" role="status">
            Originalseite wird geladen …
          </p>
        )}
      </div>
    </figure>
  );
}
