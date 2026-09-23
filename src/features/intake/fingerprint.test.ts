import { describe, expect, it } from "vitest";
import { requestFingerprint, sha256Hex } from "./fingerprint";
import { parseMailHeaders } from "./mail-headers";

const enc = (text: string) => new TextEncoder().encode(text);

describe("requestFingerprint", () => {
  it("is independent of the order of the files", () => {
    const a = sha256Hex(enc("a"));
    const b = sha256Hex(enc("b"));

    expect(requestFingerprint([a, b])).toBe(requestFingerprint([b, a]));
  });

  it("differs when one file differs", () => {
    expect(requestFingerprint([sha256Hex(enc("a"))])).not.toBe(requestFingerprint([sha256Hex(enc("a2"))]));
  });

  it("treats the same file uploaded twice in one request as one", () => {
    const a = sha256Hex(enc("a"));

    expect(requestFingerprint([a, a])).toBe(requestFingerprint([a]));
  });

  it("hashes raw bytes – CRLF and LF variants of a mail are different files", () => {
    expect(sha256Hex(enc("x\r\ny"))).not.toBe(sha256Hex(enc("x\ny")));
  });
});

describe("parseMailHeaders", () => {
  it("reads Message-ID and Subject from the header block only", () => {
    const mail = enc("From: a@example.com\r\nMessage-ID: <Abc.123@Example.com>\r\nSubject: Anfrage Flansche\r\n\r\nMessage-ID: <fake@example.com>");

    expect(parseMailHeaders(mail)).toEqual({ messageId: "<Abc.123@Example.com>", subject: "Anfrage Flansche" });
  });

  it("unfolds folded header lines and decodes RFC 2047 encoded words", () => {
    const mail = enc("Subject: =?UTF-8?B?QW5mcmFnZSBEcmVoc3TDvGNr?=\r\n =?utf-8?Q?_f=C3=BCr_KW_42?=\r\nMessage-Id:\r\n <x@example.com>\r\n\r\nbody");

    expect(parseMailHeaders(mail)).toEqual({ messageId: "<x@example.com>", subject: "Anfrage Drehstück für KW 42" });
  });

  it("returns nulls when the headers are missing", () => {
    expect(parseMailHeaders(enc("From: a@example.com\n\nbody"))).toEqual({ messageId: null, subject: null });
  });

  it("caps the subject length", () => {
    const long = "x".repeat(1000);

    expect(parseMailHeaders(enc(`Subject: ${long}\n\n`)).subject).toHaveLength(300);
  });
});
