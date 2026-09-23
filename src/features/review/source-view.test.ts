import { describe, expect, it } from "vitest";
import { buildSourceView, type StoredSegment } from "./source-view";

const pdf: StoredSegment[] = [
  { segmentId: "p1-1", position: 0, text: "Seite eins", locator: { kind: "pdf", page: 1, bbox: { l: 0, t: 0, r: 1, b: 1 }, coordOrigin: "TOPLEFT" } },
  { segmentId: "p2-1", position: 1, text: "Musterbau Beispiel GmbH, Werk Nord", locator: { kind: "pdf", page: 2, bbox: { l: 0, t: 0, r: 1, b: 1 }, coordOrigin: "TOPLEFT" } },
  { segmentId: "p2-2", position: 2, text: "Liefertermin 15.10.2026", locator: { kind: "pdf", page: 2, bbox: { l: 0, t: 0, r: 1, b: 1 }, coordOrigin: "TOPLEFT" } },
];
const mail: StoredSegment[] = [
  { segmentId: "h1", position: 0, text: "Subject: Anfrage", locator: { kind: "email", part: "header", line: 1, header: "Subject" } },
  { segmentId: "b1", position: 1, text: "Hallo,", locator: { kind: "email", part: "body", line: 1, header: null } },
  { segmentId: "b2", position: 2, text: "bitte bis KW 42 liefern.", locator: { kind: "email", part: "body", line: 2, header: null } },
];

describe("buildSourceView – where a value comes from", () => {
  it("shows the cited PDF page only, with the cited segment and the quote marked", () => {
    const view = buildSourceView(pdf, { segmentId: "p2-1", quote: "musterbau beispiel gmbh" });

    expect(view).toMatchObject({ kind: "pdf", heading: "Seite 2" });
    expect(view?.lines.map((line) => line.segmentId)).toEqual(["p2-1", "p2-2"]);
    const cited = view!.lines.find((line) => line.cited)!;
    expect(cited.parts).toEqual([
      { text: "Musterbau Beispiel GmbH", mark: true },
      { text: ", Werk Nord", mark: false },
    ]);
  });

  it("shows the mail with line labels and the cited line marked", () => {
    const view = buildSourceView(mail, { segmentId: "b2", quote: "KW 42" });

    expect(view).toMatchObject({ kind: "email", heading: "E-Mail" });
    expect(view?.lines.map((line) => line.label)).toEqual(["Kopf: Subject", "Zeile 1", "Zeile 2"]);
    expect(view?.lines[2]?.parts).toEqual([
      { text: "bitte bis ", mark: false },
      { text: "KW 42", mark: true },
      { text: " liefern.", mark: false },
    ]);
  });

  it("marks the whole segment when the quote is not found verbatim (e.g. normalised whitespace)", () => {
    const view = buildSourceView(mail, { segmentId: "b2", quote: "KW  42 !" });

    expect(view?.lines[2]?.parts).toEqual([{ text: "bitte bis KW 42 liefern.", mark: true }]);
  });

  it("returns null when the field has no evidence or the segment is unknown", () => {
    expect(buildSourceView(mail, null)).toBeNull();
    expect(buildSourceView(mail, { segmentId: "nope", quote: "x" })).toBeNull();
  });
});
