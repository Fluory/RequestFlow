"use client";

import { useState } from "react";

/** Copies a text (e.g. an invitation link) to the clipboard; the label confirms it. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // Clipboard blocked (e.g. insecure context): the link stays selectable.
    }
  }
  return (
    <button type="button" onClick={copy} aria-live="polite">
      {copied ? "Kopiert" : "Kopieren"}
    </button>
  );
}
