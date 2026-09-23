// Source view of the review screen (#8): the page or mail around a value's evidence, with the cited
// segment and quote marked. Pure – rendered by the page, tested with fixtures. The pilot shows PDF
// pages as text in reading order (decision-needed in #8); bounding boxes are stored for a later
// rendered view.
export interface StoredSegment {
  segmentId: string;
  position: number;
  text: string;
  locator: Record<string, unknown>;
}

export interface SourceLine {
  segmentId: string;
  label: string;
  cited: boolean;
  parts: Array<{ text: string; mark: boolean }>;
}

export interface SourceView {
  kind: "pdf" | "email";
  heading: string;
  lines: SourceLine[];
}

function label(locator: Record<string, unknown>): string {
  if (locator.kind === "email") {
    return locator.part === "header" ? `Kopf: ${String(locator.header ?? "")}` : `Zeile ${String(locator.line)}`;
  }
  return `Seite ${String(locator.page)}`;
}

function markQuote(text: string, quote: string): SourceLine["parts"] {
  // Exact match first; the case-insensitive fallback only when lowercasing keeps the length, so the
  // index is valid in the original text (e.g. "İ" grows) – otherwise the whole segment is marked.
  let at = quote ? text.indexOf(quote) : -1;
  if (at < 0 && quote && text.toLowerCase().length === text.length && quote.toLowerCase().length === quote.length) {
    at = text.toLowerCase().indexOf(quote.toLowerCase());
  }
  if (at < 0) return [{ text, mark: true }];
  return [
    { text: text.slice(0, at), mark: false },
    { text: text.slice(at, at + quote.length), mark: true },
    { text: text.slice(at + quote.length), mark: false },
  ].filter((part) => part.text.length > 0);
}

export function buildSourceView(segments: StoredSegment[], evidence: { segmentId: string; quote: string } | null): SourceView | null {
  if (!evidence) return null;
  const cited = segments.find((segment) => segment.segmentId === evidence.segmentId);
  if (!cited) return null;
  const isPdf = cited.locator.kind === "pdf";
  const context = segments
    .filter((segment) => !isPdf || segment.locator.page === cited.locator.page)
    .sort((a, b) => a.position - b.position);
  return {
    kind: isPdf ? "pdf" : "email",
    heading: isPdf ? `Seite ${String(cited.locator.page)}` : "E-Mail",
    lines: context.map((segment) => ({
      segmentId: segment.segmentId,
      label: label(segment.locator),
      cited: segment.segmentId === cited.segmentId,
      parts: segment.segmentId === cited.segmentId ? markQuote(segment.text, evidence.quote) : [{ text: segment.text, mark: false }],
    })),
  };
}
