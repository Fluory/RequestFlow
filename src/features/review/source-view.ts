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

type Locator = Record<string, unknown>;

/**
 * An Outlook attachment wraps its own locator (`{kind: "msg", part: "attachment", attachment, inner}`,
 * also nested). Unwrapped: the inner locator plus the attachment names, outermost first (#23/#25).
 */
function unwrap(locator: Locator): { inner: Locator; attachments: string[]; path: string } {
  let inner = locator;
  const attachments: string[] = [];
  const indexes: string[] = [];
  while (inner.kind === "msg" && inner.part === "attachment" && inner.inner && typeof inner.inner === "object") {
    const ref = (inner.attachment ?? {}) as { index?: unknown; name?: unknown };
    attachments.push(typeof ref.name === "string" && ref.name ? ref.name : `Anhang ${Number(ref.index ?? 0) + 1}`);
    indexes.push(String(ref.index));
    inner = inner.inner as Locator;
  }
  return { inner, attachments, path: indexes.join("/") };
}

/** A mail line – `.eml` or the header/body of an Outlook message. */
const isMail = (locator: Locator) => locator.kind === "email" || locator.kind === "msg";

function label(locator: Locator): string {
  if (isMail(locator)) {
    return locator.part === "header" ? `Kopf: ${String(locator.header ?? "")}` : `Zeile ${String(locator.line)}`;
  }
  if (locator.kind === "xlsx") return `${String(locator.sheet)}!${String(locator.cellRange ?? locator.cell)}`;
  if (locator.kind === "docx") {
    return locator.part === "table_cell" || (locator.part === undefined && locator.table != null)
      ? `Tabelle ${String(locator.table)}, Zeile ${String(locator.row)}, Zelle ${String(locator.cell)}`
      : `Absatz ${String(locator.paragraph)}`;
  }
  return `Seite ${String(locator.page)}`;
}

/** Segments shown around the cited one: the same PDF page or XLSX sheet; a whole mail or Word file. */
function sameContext(cited: ReturnType<typeof unwrap>, other: ReturnType<typeof unwrap>): boolean {
  if (other.path !== cited.path) return false;
  const [a, b] = [cited.inner, other.inner];
  if (isMail(a) || isMail(b)) return isMail(a) && isMail(b);
  if (a.kind !== b.kind) return false;
  if (a.kind === "pdf") return a.page === b.page;
  if (a.kind === "xlsx") return a.sheet === b.sheet;
  return true;
}

function headingOf({ inner, attachments }: ReturnType<typeof unwrap>): string {
  const base =
    inner.kind === "pdf"
      ? `Seite ${String(inner.page)}${inner.ocr === true ? " (Texterkennung)" : ""}`
      : inner.kind === "xlsx"
        ? `Tabellenblatt ${String(inner.sheet)}`
        : inner.kind === "docx"
          ? "Word-Dokument"
          : "E-Mail";
  return attachments.length > 0 ? `${attachments.map((name) => `Anhang ${name}`).join(" – ")} – ${base}` : base;
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
  const where = unwrap(cited.locator);
  const context = segments.filter((segment) => sameContext(where, unwrap(segment.locator))).sort((a, b) => a.position - b.position);
  const kind = where.inner.kind;
  return {
    kind: kind === "pdf" || kind === "xlsx" || kind === "docx" ? kind : "email",
    heading: headingOf(where),
    ocr: where.inner.ocr === true,
    lines: context.map((segment) => ({
      segmentId: segment.segmentId,
      label: label(unwrap(segment.locator).inner),
      cited: segment.segmentId === cited.segmentId,
      parts: segment.segmentId === cited.segmentId ? markQuote(segment.text, evidence.quote) : [{ text: segment.text, mark: false }],
    })),
  };
}
