import { describe, expect, it } from "vitest";
import { overlayOf } from "./pdf-overlay";

// The highlight on the rendered page (#74): the stored box as a share of the page, so it scales with the canvas.
const a4 = { width: 595, height: 842 };

describe("overlayOf", () => {
  it("places the box as percentages of the page, with a small margin around the text", () => {
    expect(overlayOf({ l: 56, t: 278.82, r: 205.49, b: 288.07 }, a4)).toEqual({ left: 9.08, top: 32.88, width: 25.8, height: 1.57 });
  });

  it("keeps a box at the page edge inside the page", () => {
    expect(overlayOf({ l: 0, t: 0, r: 595, b: 20 }, a4)).toEqual({ left: 0, top: 0, width: 100, height: 2.61 });
  });

  it("uses the displayed page – a rotated page is simply wider than high", () => {
    expect(overlayOf({ l: 783.1, t: 56, r: 796.05, b: 239.6 }, { width: 842, height: 595 })).toEqual({ left: 92.77, top: 9.08, width: 2.01, height: 31.53 });
  });

  it("has no overlay for a box outside the page or a page without size", () => {
    expect(overlayOf({ l: 700, t: 10, r: 750, b: 20 }, a4)).toBeNull();
    expect(overlayOf({ l: 10, t: 900, r: 50, b: 920 }, a4)).toBeNull();
    expect(overlayOf({ l: 10, t: 10, r: 50, b: 20 }, { width: 0, height: 842 })).toBeNull();
  });
});
