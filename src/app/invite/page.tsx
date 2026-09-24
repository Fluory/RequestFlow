import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { CopyButton } from "@/app/_components/copy-button";
import { currentActor, getRuntime, requestActor } from "@/app/_server/runtime";
import { authorize, AuthorizationError, inviteUser, COMPANY_ROLES, type Actor } from "@/features/identity";

export const dynamic = "force-dynamic";

const inviteInput = z.object({ email: z.email().max(254), role: z.enum(COMPANY_ROLES) });

// The page passes the per-request cached actor (shared with the app header); the action reads its own.
async function adminOrNotFound(actor: Actor | null): Promise<Actor> {
  if (!actor) redirect("/login");
  try {
    authorize(actor, "users.invite");
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  return actor;
}

// Invite form (pilot: no role-admin UI; e-mail delivery is out of scope). Authorization runs
// server-side on render AND in the action. The admin hands the link over to the invited person.
async function invite(formData: FormData) {
  "use server";
  const actor = await adminOrNotFound(await currentActor(await headers()));
  const input = inviteInput.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!input.success) redirect("/invite?error=input");
  const { invitationId } = await inviteUser(getRuntime().database.db, actor, input.data);
  redirect(`/invite?invitation=${invitationId}`);
}

export default async function InvitePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await adminOrNotFound(await requestActor());
  const params = await searchParams;
  const link = params.invitation ? `${getRuntime().config.auth.baseURL}/signup?invitation=${encodeURIComponent(params.invitation)}` : null;
  return (
    <main>
      <Link href="/users" className="back">
        ← Benutzer
      </Link>
      <h1>Mitarbeitende einladen</h1>
      <div className="invite-form">
        <section className="card card-pad" aria-label="Einladung">
          {params.error && <p role="alert">Bitte eine gültige E-Mail-Adresse und Rolle angeben.</p>}
          <form action={invite} className="auth-form">
            <label className="field" htmlFor="email">
              <span>E-Mail</span>
              <input id="email" name="email" type="email" required maxLength={254} placeholder="vorname.nachname@example.com" />
            </label>
            <label className="field" htmlFor="role">
              <span>Rolle</span>
              <select id="role" name="role" defaultValue="clerk">
                <option value="clerk">Sachbearbeitung</option>
                <option value="admin">Administration</option>
              </select>
            </label>
            <div>
              <button type="submit" className="btn-primary btn-large">
                Einladen
              </button>
            </div>
          </form>
        </section>
        {link && (
          <section role="status" className="invite-done">
            <strong>Einladung angelegt (7 Tage gültig).</strong>
            <span>Diesen Link selbst an die eingeladene Person weitergeben. Eine E-Mail wird nicht verschickt.</span>
            <div className="copy-row">
              <code>{link}</code>
              <CopyButton text={link} />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
