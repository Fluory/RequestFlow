import Link from "next/link";
import { AuthForm } from "@/app/_components/auth-form";

export default function SignupPage() {
  return (
    <main>
      <h1>Konto anlegen</h1>
      <p>Nur mit Einladung: Verwenden Sie die E-Mail-Adresse, an die die Einladung ging.</p>
      <AuthForm mode="sign-up" />
      <p>
        <Link href="/login">Zur Anmeldung</Link>
      </p>
    </main>
  );
}
