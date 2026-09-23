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

  it("never marks a shifted range when lowercasing changes the text length (e.g. \"İ\")", () => {
    const segments: StoredSegment[] = [{ segmentId: "b1", position: 0, text: "İzmir Werk: KW 42", locator: { kind: "email", part: "body", line: 1, header: null } }];

    expect(buildSourceView(segments, { segmentId: "b1", quote: "kw 42" })?.lines[0]?.parts).toEqual([{ text: "İzmir Werk: KW 42", mark: true }]);
    expect(buildSourceView(segments, { segmentId: "b1", quote: "KW 42" })?.lines[0]?.parts).toEqual([
      { text: "İzmir Werk: ", mark: false },
      { text: "KW 42", mark: true },
    ]);
  });

  it("returns null when the field has no evidence or the segment is unknown", () => {
    expect(buildSourceView(mail, null)).toBeNull();
    expect(buildSourceView(mail, { segmentId: "nope", quote: "x" })).toBeNull();
  });

  it("shows an XLSX cell with its sheet and cell, only cells of the same sheet as context (#25)", () => {
    const cells: StoredSegment[] = [
      { segmentId: "x1", position: 0, text: "Menge", locator: { kind: "xlsx", sheet: "Positionen", cell: "B1" } },
      { segmentId: "x2", position: 1, text: "1.250", locator: { kind: "xlsx", sheet: "Positionen", cell: "B2" } },
      { segmentId: "x3", position: 2, text: "Notiz", locator: { kind: "xlsx", sheet: "Hinweise", cell: "A1" } },
    ];

    const view = buildSourceView(cells, { segmentId: "x2", quote: "1.250" });

    expect(view).toMatchObject({ kind: "xlsx", heading: "Tabellenblatt Positionen", ocr: false });
    expect(view?.lines.map((line) => line.label)).toEqual(["Positionen!B1", "Positionen!B2"]);
    expect(view?.lines[1]).toMatchObject({ cited: true, parts: [{ text: "1.250", mark: true }] });
  });

  it("shows DOCX paragraphs and table cells with their position (#25)", () => {
    const docx: StoredSegment[] = [
      { segmentId: "d1", position: 0, text: "Sehr geehrte Damen und Herren,", locator: { kind: "docx", paragraph: 1 } },
      { segmentId: "d2", position: 1, text: "Werkstoff 1.4301", locator: { kind: "docx", table: 1, row: 2, cell: 3 } },
    ];

    const view = buildSourceView(docx, { segmentId: "d2", quote: "1.4301" });

    expect(view).toMatchObject({ kind: "docx", heading: "Word-Dokument" });
    expect(view?.lines.map((line) => line.label)).toEqual(["Absatz 1", "Tabelle 1, Zeile 2, Zelle 3"]);
  });

  it("labels OCR evidence as OCR – the page heading and the view say so (#25)", () => {
    const scanned: StoredSegment[] = [{ segmentId: "o1", position: 0, text: "Liefertermin 15.10.2026", locator: { kind: "pdf", page: 1, ocr: true } }];

    const view = buildSourceView(scanned, { segmentId: "o1", quote: "15.10.2026" });

    expect(view).toMatchObject({ kind: "pdf", heading: "Seite 1 (Texterkennung)", ocr: true });
  });

  it("prefixes evidence from an e-mail attachment with the attachment name (#25)", () => {
    const msg: StoredSegment[] = [{ segmentId: "a1", position: 0, text: "DN 100", locator: { kind: "xlsx", sheet: "Tabelle1", cell: "C4", attachment: "positionen.xlsx" } }];

    expect(buildSourceView(msg, { segmentId: "a1", quote: "DN 100" })?.heading).toBe("Anhang positionen.xlsx – Tabellenblatt Tabelle1");
  });
});

