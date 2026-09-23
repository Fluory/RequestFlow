"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// Posts JSON straight to Better Auth (/api/auth/*); cookies are set by that response, so no extra
// auth plugin is needed for server actions.
export function AuthForm({ mode, invitationId }: { mode: "sign-in" | "sign-up"; invitationId?: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setFailed(false);
    const form = new FormData(event.currentTarget);
    const body = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      ...(mode === "sign-up" ? { name: String(form.get("name") ?? ""), invitationId } : {}),
    };
    const response = await fetch(`/api/auth/${mode}/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (mode === "sign-in") {
      if (response.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      setFailed(true);
      setMessage(response.status === 429 ? "Zu viele Versuche – bitte später erneut versuchen." : "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.");
      return;
    }
    // Same answer for invited and uninvited addresses (no enumeration).
    setFailed(!response.ok);
    setMessage(
      response.ok
        ? "Falls für diese Adresse eine Einladung vorliegt, ist das Konto jetzt angelegt. Bitte anmelden."
        : "Registrierung fehlgeschlagen. Passwort mindestens 12 Zeichen.",
    );
  }

  return (
    <form onSubmit={submit} aria-busy={busy}>
      {mode === "sign-up" && (
        <p className="field">
          <label htmlFor="name">Name</label>
          <input id="name" name="name" required autoComplete="name" />
        </p>
      )}
      <p className="field">
        <label htmlFor="email">E-Mail</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </p>
      <p className="field">
        <label htmlFor="password">Passwort</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        />
      </p>
      <p>
        <button type="submit" className="btn-primary" disabled={busy}>
          {mode === "sign-in" ? "Anmelden" : "Konto anlegen"}
        </button>
      </p>
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    router.push("/login");
    router.refresh();
  }
  return (
    <button type="button" className="btn-ghost btn-small" onClick={signOut}>
      Abmelden
    </button>
  );
}
