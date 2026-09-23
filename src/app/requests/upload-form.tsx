"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// Posts the selected files to POST /api/requests; errors from the server are shown verbatim
// (they are written for users, e.g. "Dateityp nicht erlaubt").
export function UploadForm() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/requests", { method: "POST", body: new FormData(formElement) });
    setBusy(false);
    if (response.ok) {
      const result = (await response.json()) as { possibleDuplicate: boolean };
      setMessage(result.possibleDuplicate ? "Anfrage angelegt – möglicherweise ein Duplikat, bitte prüfen." : "Anfrage angelegt.");
      formElement.reset();
      router.refresh();
      return;
    }
    const body = (await response.json().catch(() => null)) as { error?: { title?: string } } | null;
    setMessage(body?.error?.title ?? "Upload fehlgeschlagen.");
  }

  return (
    <form onSubmit={submit} aria-busy={busy}>
      <p>
        <label htmlFor="files">E-Mail (.eml, .msg) oder Dateien (.pdf, .xlsx, .docx)</label>
        <br />
        <input id="files" name="files" type="file" multiple required accept=".eml,.msg,.pdf,.xlsx,.docx" />
      </p>
      <button type="submit" disabled={busy}>
        {busy ? "Wird hochgeladen …" : "Anfrage hochladen"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
