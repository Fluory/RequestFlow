import Link from "next/link";
import { Brand } from "@/app/_components/app-header";
import { AuthForm } from "@/app/_components/auth-form";

// Invite-only: the link from the invitation carries its id (`/signup?invitation=<id>`).
export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { invitation } = await searchParams;
  return (
    <main className="auth">
      <div className="auth-inner">
        <Brand className="auth-brand" />
        <div className="card">
          <h1>Konto anlegen</h1>
          {invitation ? (
            <>
              <p className="muted">Verwenden Sie die E-Mail-Adresse, an die die Einladung ging.</p>
              <AuthForm mode="sign-up" invitationId={invitation} />
            </>
          ) : (
            <p>Ein Konto kann nur über einen Einladungslink angelegt werden. Bitte wenden Sie sich an die Administration Ihrer Firma.</p>
          )}
        </div>
        <p className="auth-foot">
          <Link href="/login">Zur Anmeldung</Link>
        </p>
      </div>
    </main>
  );
}
