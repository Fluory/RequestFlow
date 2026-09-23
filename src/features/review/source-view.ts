// Source view of the review screen (#8, all formats #25): the page, sheet, document or mail around a
// value's evidence, with the cited segment and quote marked. Pure – rendered by the page, tested with fixtures. The pilot shows PDF
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
  kind: "pdf" | "email" | "xlsx" | "docx";
  heading: string;
  /** The cited segment comes from text recognition (scanned PDF) – the page says so (#25). */
  ocr: boolean;
  lines: SourceLine[];
}

function label(locator: Record<string, unknown>): string {
  if (locator.kind === "email") {
    return locator.part === "header" ? `Kopf: ${String(locator.header ?? "")}` : `Zeile ${String(locator.line)}`;
  }
  if (locator.kind === "xlsx") return `${String(locator.sheet)}!${String(locator.cell)}`;
  if (locator.kind === "docx") {
    return locator.table !== undefined ? `Tabelle ${String(locator.table)}, Zeile ${String(locator.row)}, Zelle ${String(locator.cell)}` : `Absatz ${String(locator.paragraph)}`;
  }
  return `Seite ${String(locator.page)}`;
}

/** Segments shown around the cited one: the same PDF page or XLSX sheet; a whole mail or Word file. */
function sameContext(cited: Record<string, unknown>, other: Record<string, unknown>): boolean {
  if (other.kind !== cited.kind || other.attachment !== cited.attachment) return false;
  if (cited.kind === "pdf") return other.page === cited.page;
  if (cited.kind === "xlsx") return other.sheet === cited.sheet;
  return true;
}

function headingOf(locator: Record<string, unknown>): string {
  const base =
    locator.kind === "pdf"
      ? `Seite ${String(locator.page)}${locator.ocr === true ? " (Texterkennung)" : ""}`
      : locator.kind === "xlsx"
        ? `Tabellenblatt ${String(locator.sheet)}`
        : locator.kind === "docx"
          ? "Word-Dokument"
          : "E-Mail";
  return typeof locator.attachment === "string" ? `Anhang ${locator.attachment} – ${base}` : base;
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
  const context = segments.filter((segment) => sameContext(cited.locator, segment.locator)).sort((a, b) => a.position - b.position);
  const kind = cited.locator.kind;
  return {
    kind: kind === "pdf" || kind === "xlsx" || kind === "docx" ? kind : "email",
    heading: headingOf(cited.locator),
    ocr: cited.locator.ocr === true,
    lines: context.map((segment) => ({
      segmentId: segment.segmentId,
      label: label(segment.locator),
      cited: segment.segmentId === cited.segmentId,
      parts: segment.segmentId === cited.segmentId ? markQuote(segment.text, evidence.quote) : [{ text: segment.text, mark: false }],
    })),
  };
}
