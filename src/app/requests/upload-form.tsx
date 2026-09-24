"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// Posts the selected files to POST /api/requests; errors from the server are shown verbatim
// (they are written for users, e.g. "Dateityp nicht erlaubt").
export function UploadForm() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage(null);
    setFailed(false);
    setOpenId(null);
    const response = await fetch("/api/requests", { method: "POST", body: new FormData(formElement) });
    setBusy(false);
    if (response.ok) {
      const result = (await response.json()) as { requestId: string; possibleDuplicate: boolean };
      setMessage(result.possibleDuplicate ? "Anfrage angelegt – möglicherweise ein Duplikat, bitte prüfen." : "Anfrage angelegt. Die Verarbeitung startet automatisch.");
      setOpenId(result.requestId);
      formElement.reset();
      router.refresh();
      return;
    }
    const body = (await response.json().catch(() => null)) as { error?: { title?: string } } | null;
    setFailed(true);
    setMessage(body?.error?.title ?? "Upload fehlgeschlagen.");
  }

  return (
    <form onSubmit={submit} aria-busy={busy} className="upload">
      <div>
        <h2>Anfrage hochladen</h2>
        <p className="muted">E-Mail oder die Dateien einer Anfrage, auch mehrere zusammen</p>
      </div>
      <div className="upload-row">
        <div className="dropzone">
          <label htmlFor="files">E-Mail (.eml, .msg) oder Dateien (.pdf, .xlsx, .docx)</label>
          <input id="files" name="files" type="file" multiple required accept=".eml,.msg,.pdf,.xlsx,.docx" />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Wird hochgeladen …" : "Anfrage hochladen"}
        </button>
      </div>
      {message && (
        <div role={failed ? "alert" : "status"}>
          <span>{message}</span>
          {!failed && openId && <Link href={`/requests/${openId}`}>Anfrage öffnen</Link>}
        </div>
      )}
    </form>
  );
}
