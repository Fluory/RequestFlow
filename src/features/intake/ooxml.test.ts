import { describe, expect, it } from "vitest";
import { inspectOoxml } from "./ooxml";
import { makeZip } from "./zip-fixture";

const XLSX: Array<[string, number]> = [
  ["[Content_Types].xml", 1000],
  ["xl/workbook.xml", 800],
  ["xl/worksheets/sheet1.xml", 5000],
];
const DOCX: Array<[string, number]> = [
  ["[Content_Types].xml", 1000],
  ["word/document.xml", 9000],
];

describe("inspectOoxml", () => {
  it("accepts a well-formed workbook and document", () => {
    expect(inspectOoxml(makeZip(XLSX), "xlsx")).toEqual({ ok: true });
    expect(inspectOoxml(makeZip(DOCX), "docx")).toEqual({ ok: true });
  });

  it("rejects a macro-enabled package renamed to .xlsx / .docx", () => {
    expect(inspectOoxml(makeZip([...XLSX, ["xl/vbaProject.bin", 4000]]), "xlsx")).toMatchObject({ ok: false, reason: "macros" });
    expect(inspectOoxml(makeZip([...DOCX, ["word/vbaProject.bin", 4000]]), "docx")).toMatchObject({ ok: false, reason: "macros" });
    expect(inspectOoxml(makeZip([...XLSX, ["xl/macrosheets/sheet1.xml", 10]]), "xlsx")).toMatchObject({ ok: false, reason: "macros" });
  });

  it("rejects a ZIP that is not the claimed OOXML type (e.g. a .jar or a docx renamed to .xlsx)", () => {
    expect(inspectOoxml(makeZip([["META-INF/MANIFEST.MF", 10], ["a.class", 10]]), "xlsx")).toMatchObject({ ok: false, reason: "structure" });
    expect(inspectOoxml(makeZip(DOCX), "xlsx")).toMatchObject({ ok: false, reason: "structure" });
  });

  it("rejects zip bombs by declared uncompressed size and by entry count", () => {
    expect(inspectOoxml(makeZip([...XLSX, ["xl/media/huge.bin", 0xfffffff0]]), "xlsx")).toMatchObject({ ok: false, reason: "too-large" });
    const many: Array<[string, number]> = Array.from({ length: 3000 }, (_, i) => [`xl/x${i}.xml`, 1]);
    expect(inspectOoxml(makeZip([...XLSX, ...many]), "xlsx")).toMatchObject({ ok: false, reason: "too-large" });
  });

  it("rejects truncated or garbage archives", () => {
    expect(inspectOoxml(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), "xlsx")).toMatchObject({ ok: false, reason: "structure" });
  });
});
