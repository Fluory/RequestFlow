import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoBanner } from "./demo-banner";

// DEMO_MODE (#59): the showcase says on every page that it holds synthetic data only (root layout).
describe("DemoBanner", () => {
  it("shows a labelled note „Demo – nur synthetische Daten“ when demo mode is on", () => {
    const html = renderToStaticMarkup(createElement(DemoBanner, { enabled: true }));

    expect(html).toContain('role="note"');
    expect(html).toContain('class="demo-banner"');
    expect(html).toContain("Demo – nur synthetische Daten");
  });

  it("renders nothing when demo mode is off", () => {
    expect(renderToStaticMarkup(createElement(DemoBanner, { enabled: false }))).toBe("");
  });
});
