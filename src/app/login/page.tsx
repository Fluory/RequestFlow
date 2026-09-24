import Link from "next/link";
import { Brand } from "@/app/_components/app-header";
import { AuthForm } from "@/app/_components/auth-form";

export default function LoginPage() {
  return (
    <main className="auth">
      <div className="auth-inner">
        <Brand className="auth-brand" />
        <div className="card">
          <h1>Anmelden</h1>
          <AuthForm mode="sign-in" />
        </div>
        <p className="auth-foot">
          Eingeladen? <Link href="/signup">Konto anlegen</Link>
        </p>
      </div>
    </main>
  );
}
