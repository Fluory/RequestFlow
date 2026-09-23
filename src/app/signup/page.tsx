import Link from "next/link";
import { AuthForm } from "@/app/_components/auth-form";

// Invite-only: the link from the invitation carries its id (`/signup?invitation=<id>`).
export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { invitation } = await searchParams;
  return (
    <main>
      <div className="auth card">
        <h1>Konto anlegen</h1>
        {invitation ? (
          <>
            <p className="lead">Verwenden Sie die E-Mail-Adresse, an die die Einladung ging.</p>
            <AuthForm mode="sign-up" invitationId={invitation} />
          </>
        ) : (
          <p role="alert">Ein Konto kann nur über einen Einladungslink angelegt werden. Bitte wenden Sie sich an Ihre Administration.</p>
        )}
        <p className="muted">
          <Link href="/login">Zur Anmeldung</Link>
        </p>
      </div>
    </main>
  );
}
