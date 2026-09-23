import type { DocumentKind } from "@/db/schema";
import { inspectOoxml } from "./ooxml";

// Upload validation (security rule: untrusted files). Allow-list by extension AND content: signature
// for all types, OOXML package structure for .xlsx/.docx (no macros, no foreign ZIPs, no zip bombs).
// Known limit: .msg is checked by its OLE signature only (registered risk). Messages are user-facing.
export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejected";
  }
}

export interface UploadLimits {
  maxFileBytes: number;
}

export interface ClassifiedFile {
  kind: DocumentKind;
  filename: string;
  contentType: string;
}

const CONTENT_TYPES: Record<DocumentKind, string> = {
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((value, index) => bytes[index] === value);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

function looksLikeMail(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  const text = new TextDecoder("latin1").decode(head);
  return /^[\x21-\x39\x3b-\x7e]+:/m.test(text) && /^(from|message-id|subject|date|to|received|return-path|mime-version):/im.test(text);
}

const SIGNATURE_CHECK: Record<DocumentKind, (bytes: Uint8Array) => boolean> = {
  pdf: (bytes) => startsWith(bytes, PDF),
  xlsx: (bytes) => startsWith(bytes, ZIP),
  docx: (bytes) => startsWith(bytes, ZIP),
  msg: (bytes) => startsWith(bytes, OLE),
  eml: looksLikeMail,
};

/** Base name only, no control characters, bounded length. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(-200);
  return cleaned || "datei";
}

export function classifyUpload(name: string, bytes: Uint8Array, limits: UploadLimits): ClassifiedFile {
  const filename = safeFilename(name);
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (!(extension in CONTENT_TYPES)) {
    throw new UploadRejected(`Dateityp nicht erlaubt: ${filename}. Erlaubt sind .eml, .msg, .pdf, .xlsx und .docx.`);
  }
  const kind = extension as DocumentKind;
  if (bytes.byteLength === 0) throw new UploadRejected(`Die Datei ${filename} ist leer.`);
  if (bytes.byteLength > limits.maxFileBytes) {
    throw new UploadRejected(`Die Datei ${filename} ist zu groß (maximal ${Math.floor(limits.maxFileBytes / (1024 * 1024)) || 1} MB).`);
  }
  if (!SIGNATURE_CHECK[kind](bytes)) {
    throw new UploadRejected(`Der Inhalt von ${filename} passt nicht zum Dateityp .${kind}.`);
  }
  if (kind === "xlsx" || kind === "docx") {
    const check = inspectOoxml(bytes, kind);
    if (!check.ok && check.reason === "macros") throw new UploadRejected(`Die Datei ${filename} enthält Makros – nicht erlaubt.`);
    if (!check.ok && check.reason === "too-large") throw new UploadRejected(`Die Datei ${filename} ist entpackt zu groß.`);
    if (!check.ok) throw new UploadRejected(`Der Inhalt von ${filename} passt nicht zum Dateityp .${kind}.`);
  }
  return { kind, filename, contentType: CONTENT_TYPES[kind] };
}
