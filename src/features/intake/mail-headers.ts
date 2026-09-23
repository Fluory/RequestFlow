// Minimal RFC 5322 header reader for intake: Message-ID (duplicates) and Subject (list display).
// Full parsing of bodies and attachments is the AI service's job (docling / stdlib email).
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_SUBJECT = 300;

export interface MailHeaders {
  messageId: string | null;
  subject: string | null;
}

function headerBlock(bytes: Uint8Array): string {
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, MAX_HEADER_BYTES));
  const end = text.search(/\r?\n\r?\n/);
  return (end === -1 ? text : text.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
}

function latin1ToUtf8(text: string): string {
  return new TextDecoder("utf-8").decode(Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff));
}

function decodeEncodedWords(value: string): string {
  const decoded = value.replace(/\?=\s+=\?/g, "?==?").replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_all, charset: string, encoding: string, data: string) => {
    let raw: Uint8Array;
    if (encoding.toUpperCase() === "B") {
      raw = Uint8Array.from(Buffer.from(data, "base64"));
    } else {
      const text = data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      raw = Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
    }
    try {
      return new TextDecoder(charset.toLowerCase()).decode(raw);
    } catch {
      return new TextDecoder("utf-8").decode(raw);
    }
  });
  return decoded;
}

function header(block: string, name: string): string | null {
  const match = block.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "im"));
  const value = match?.[1]?.trim();
  return value ? value : null;
}

export function parseMailHeaders(bytes: Uint8Array): MailHeaders {
  const block = headerBlock(bytes);
  const messageId = header(block, "Message-ID");
  const rawSubject = header(block, "Subject");
  const subject = rawSubject === null ? null : decodeEncodedWords(/[^\x00-\x7f]/.test(rawSubject) ? latin1ToUtf8(rawSubject) : rawSubject);
  return {
    messageId: messageId ? messageId.slice(0, 998) : null,
    subject: subject ? subject.slice(0, MAX_SUBJECT) : null,
  };
}
