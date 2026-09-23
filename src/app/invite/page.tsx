import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { authorize, AuthorizationError, inviteUser, isCompanyRole } from "@/features/identity";

export const dynamic = "force-dynamic";

// Invite form (pilot: no role-admin UI). Authorization runs server-side on render AND in the action.
async function invite(formData: FormData) {
  "use server";
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!isCompanyRole(role) || !email.includes("@")) redirect("/invite?error=input");
  await inviteUser(getRuntime().database.db, actor, { email, role });
  redirect("/invite?sent=1");
}

export default async function InvitePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  try {
    authorize(actor, "users.invite");
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  const params = await searchParams;
  return (
    <main>
      <h1>Mitarbeitende einladen</h1>
      {params.sent && <p role="status">Einladung angelegt. Die Person kann jetzt unter /signup ein Konto anlegen.</p>}
      {params.error && <p role="alert">Bitte eine gültige E-Mail-Adresse und Rolle angeben.</p>}
      <form action={invite}>
        <p>
          <label htmlFor="email">E-Mail</label>
          <br />
          <input id="email" name="email" type="email" required />
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
