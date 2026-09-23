import { describe, expect, it } from "vitest";
import { classifyUpload, UploadRejected } from "./files";
import { makeZip, MINIMAL_DOCX, MINIMAL_XLSX } from "./zip-fixture";

const bytes = (text: string) => new TextEncoder().encode(text);
const PDF = bytes("%PDF-1.7\n%synthetic\n");
const XLSX = makeZip(MINIMAL_XLSX);
const DOCX = makeZip(MINIMAL_DOCX);
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const EML = bytes("From: Einkauf <einkauf@example.com>\r\nSubject: Anfrage\r\nMessage-ID: <abc@example.com>\r\n\r\nHallo");
const limits = { maxFileBytes: 1024 };

describe("classifyUpload", () => {
  it.each([
    ["anfrage.pdf", PDF, "pdf"],
    ["positionen.xlsx", XLSX, "xlsx"],
    ["spezifikation.docx", DOCX, "docx"],
    ["weitergeleitet.msg", OLE, "msg"],
    ["anfrage.eml", EML, "eml"],
    ["ANFRAGE.PDF", PDF, "pdf"],
  ] as const)("accepts %s as %s", (name, content, kind) => {
    expect(classifyUpload(name, content, limits).kind).toBe(kind);
  });

  it("rejects an unsupported extension with a clear message", () => {
    expect(() => classifyUpload("makro.xlsm", XLSX, limits)).toThrow(/Dateityp nicht erlaubt/);
    expect(() => classifyUpload("programm.exe", bytes("MZ"), limits)).toThrow(UploadRejected);
  });

  it("rejects content that does not match the extension (renamed files)", () => {
    expect(() => classifyUpload("anfrage.pdf", XLSX, limits)).toThrow(/passt nicht zum Dateityp/);
    expect(() => classifyUpload("tabelle.xlsx", PDF, limits)).toThrow(/passt nicht zum Dateityp/);
    expect(() => classifyUpload("mail.eml", new Uint8Array([0x00, 0x01, 0x02]), limits)).toThrow(/passt nicht zum Dateityp/);
  });

  it("rejects a macro workbook renamed to .xlsx and a workbook renamed to .docx", () => {
    expect(() => classifyUpload("umbenannt.xlsx", makeZip([...MINIMAL_XLSX, ["xl/vbaProject.bin", 10]]), limits)).toThrow(/Makros/);
    expect(() => classifyUpload("tabelle.docx", XLSX, limits)).toThrow(/passt nicht zum Dateityp/);
  });

  it("rejects files above the size limit and empty files", () => {
    expect(() => classifyUpload("gross.pdf", new Uint8Array(2048).fill(0x25), limits)).toThrow(/zu groß/);
    expect(() => classifyUpload("leer.pdf", new Uint8Array(0), limits)).toThrow(/leer/);
  });

  it("strips path components and control characters from the stored file name", () => {
    expect(classifyUpload("../../etc/anfrage\u0000.pdf", PDF, limits).filename).toBe("anfrage.pdf");
    expect(classifyUpload("C:\\temp\\anfrage.pdf", PDF, limits).filename).toBe("anfrage.pdf");
  });
});
