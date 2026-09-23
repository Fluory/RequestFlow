import { createHash } from "node:crypto";

// Exact-duplicate detection (ADR-0001 D9, DR7): SHA-256 over the raw bytes of every file, and a
// request fingerprint over the set of file hashes (order-independent, duplicates collapsed).
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function requestFingerprint(fileHashes: string[]): string {
  const set = [...new Set(fileHashes)].sort();
  return sha256Hex(new TextEncoder().encode(set.join("\n")));
}
