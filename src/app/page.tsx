import Link from "next/link";
import { headers } from "next/headers";
import { SignOutButton } from "@/app/_components/auth-form";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { getCompany } from "@/features/identity";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const actor = await currentActor(await headers());
  if (!actor) {
    return (
      <main>
        <h1>RequestFlow</h1>
        <p>Angebotsanfragen erfassen, neben der Quelle prüfen und genau einmal ans ERP übergeben.</p>
        <p>
          <Link href="/login">Anmelden</Link> · <Link href="/signup">Konto mit Einladung anlegen</Link>
        </p>
        <p>Pilot – alle Daten sind synthetisch.</p>
      </main>
    );
  }
  const company = await getCompany(getRuntime().database.db, actor.companyId);
  return (
    <main>
      <h1>RequestFlow</h1>
      <p>
        Firma: <strong>{company?.name}</strong> · Rolle: {actor.role === "admin" ? "Administration" : "Sachbearbeitung"}
      </p>
      <p>
        <Link href="/requests">Anfragen</Link>
      </p>
      {actor.role === "admin" && (
        <p>
          <Link href="/invite">Mitarbeitende einladen</Link>
        </p>
      )}
      <SignOutButton />
    </main>
  );
}
