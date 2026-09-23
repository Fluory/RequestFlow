import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { authorize, AuthorizationError, inviteUser, COMPANY_ROLES, type Actor } from "@/features/identity";

export const dynamic = "force-dynamic";

const inviteInput = z.object({ email: z.email().max(254), role: z.enum(COMPANY_ROLES) });

async function adminOrNotFound(): Promise<Actor> {
  const actor = await currentActor(await headers());
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
  const actor = await adminOrNotFound();
  const input = inviteInput.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!input.success) redirect("/invite?error=input");
  const { invitationId } = await inviteUser(getRuntime().database.db, actor, input.data);
  redirect(`/invite?invitation=${invitationId}`);
}

export default async function InvitePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await adminOrNotFound();
  const params = await searchParams;
  const link = params.invitation ? `${getRuntime().config.auth.baseURL}/signup?invitation=${encodeURIComponent(params.invitation)}` : null;
  return (
    <main>
      <h1>Mitarbeitende einladen</h1>
      {link && (
        <p role="status">
          Einladung angelegt (7 Tage gültig). Diesen Link an die eingeladene Person weitergeben: <code>{link}</code>
        </p>
      )}
      {params.error && <p role="alert">Bitte eine gültige E-Mail-Adresse und Rolle angeben.</p>}
      <form action={invite}>
        <p>
          <label htmlFor="email">E-Mail</label>
          <br />
          <input id="email" name="email" type="email" required maxLength={254} />
        </p>
        <p>
          <label htmlFor="role">Rolle</label>
          <br />
          <select id="role" name="role" defaultValue="clerk">
            <option value="clerk">Sachbearbeitung</option>
            <option value="admin">Administration</option>
          </select>
        </p>
        <button type="submit">Einladen</button>
      </form>
    </main>
  );
}
