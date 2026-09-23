import Link from "next/link";
import { AuthForm } from "@/app/_components/auth-form";

export default function LoginPage() {
  return (
    <main>
      <h1>Anmelden</h1>
      <AuthForm mode="sign-in" />
      <p>
        Eingeladen worden? <Link href="/signup">Konto anlegen</Link>
      </p>
    </main>
  );
}
