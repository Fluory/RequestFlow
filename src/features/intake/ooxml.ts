// Structure check of Office Open XML uploads (.xlsx/.docx) from the ZIP central directory only –
// nothing is decompressed. Rejects macro packages, foreign ZIPs (.jar, renamed types) and zip bombs
// by declared size/entry count, before the file reaches storage or the AI service.
export type OoxmlCheck = { ok: true } | { ok: false; reason: "structure" | "macros" | "too-large" };

const MAX_ENTRIES = 2000;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAIN_PART = { xlsx: "xl/workbook.xml", docx: "word/document.xml" } as const;
const MACRO_PARTS = /(^|\/)vbaProject\.bin$|^xl\/macrosheets\/|(^|\/)activeX\//i;

export function inspectOoxml(bytes: Uint8Array, kind: "xlsx" | "docx"): OoxmlCheck {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: last 22 bytes plus up to 64 KiB comment.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: "structure" };
  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff) return { ok: false, reason: "structure" }; // ZIP64: not expected here
  if (entries > MAX_ENTRIES) return { ok: false, reason: "too-large" };
  if (cdOffset + cdSize > eocd) return { ok: false, reason: "structure" };

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const names = new Set<string>();
  let total = 0;
  let at = cdOffset;
  for (let index = 0; index < entries; index++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== 0x02014b50) return { ok: false, reason: "structure" };
    total += view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (at + 46 + nameLength > eocd) return { ok: false, reason: "structure" };
    names.add(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (total > MAX_UNCOMPRESSED_BYTES) return { ok: false, reason: "too-large" };
  for (const name of names) if (MACRO_PARTS.test(name)) return { ok: false, reason: "macros" };
  if (!names.has("[Content_Types].xml") || !names.has(MAIN_PART[kind])) return { ok: false, reason: "structure" };
  return { ok: true };
}
