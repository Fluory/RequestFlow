import type { PageRegion } from "@/features/review";

// The highlight on the rendered PDF page (#74): the stored box as a share of the page, so it scales with
// the canvas. docling's boxes are in the displayed page's space – already rotated for `/Rotate` – which is
// also pdf.js's default viewport (ADR-0002): no rotation here.
export interface Overlay {
  /** Percent of the page width or height. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Margin around the text in PDF points, so the highlight does not touch the glyphs. */
const MARGIN = 2;

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
const percent = (value: number, of: number) => Math.round((value / of) * 10_000) / 100;

/** Null for a page without size or a box outside the page. */
export function overlayOf(bbox: PageRegion["bbox"], page: { width: number; height: number }): Overlay | null {
  if (!(page.width > 0 && page.height > 0)) return null;
  const left = clamp(bbox.l - MARGIN, page.width);
  const right = clamp(bbox.r + MARGIN, page.width);
  const top = clamp(bbox.t - MARGIN, page.height);
  const bottom = clamp(bbox.b + MARGIN, page.height);
  if (right <= left || bottom <= top) return null;
  return { left: percent(left, page.width), top: percent(top, page.height), width: percent(right - left, page.width), height: percent(bottom - top, page.height) };
}
