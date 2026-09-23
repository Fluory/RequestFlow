import Link from "next/link";
import { AuthForm } from "@/app/_components/auth-form";

export default function LoginPage() {
  return (
    <main>
      <div className="auth card">
        <h1>Anmelden</h1>
        <p className="lead">Mit Ihrem RequestFlow-Konto anmelden.</p>
        <AuthForm mode="sign-in" />
        <p className="muted">
          Eingeladen worden? <Link href="/signup">Konto anlegen</Link>
        </p>
      </div>
    </main>
  );
}
