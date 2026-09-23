import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getRuntime, requestActor } from "@/app/_server/runtime";
import { getCompany, type Actor } from "@/features/identity";
import { logEvent } from "@/features/observability";
import { SignOutButton } from "./auth-form";
import { NavLink } from "./nav-link";

const ROLE_LABEL = { admin: "Administration", clerk: "Sachbearbeitung" } as const;

async function signedIn(): Promise<{ actor: Actor; companyName: string | undefined } | null> {
  try {
    const actor = await requestActor();
    if (!actor) return null;
    const company = await getCompany(getRuntime().database.db, actor.companyId);
    return { actor, companyName: company?.name };
  } catch (error) {
    unstable_rethrow(error); // Next.js control flow (dynamic rendering, redirects) is not a failure.
    // The header must never take a page down (e.g. database unreachable): show the brand only.
    logEvent("error", "app_header.failed", {}, { code: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

// App shell (#52): brand on every page; navigation, company, role and sign-out only when signed in.
// Navigation mirrors the server-side permissions – it hides links, it never grants access.
export async function AppHeader() {
  const session = await signedIn();
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          RequestFlow
          <span className="env-tag">Pilot</span>
        </Link>
        {session && (
          <>
            <nav className="app-nav" aria-label="Hauptnavigation">
              <NavLink href="/requests">Anfragen</NavLink>
              {session.actor.role === "admin" && <NavLink href="/users">Benutzer</NavLink>}
            </nav>
            <div className="account">
              <span>
                <strong>{session.companyName}</strong> · Rolle: {ROLE_LABEL[session.actor.role]}
              </span>
              <SignOutButton />
            </div>
          </>
        )}
      </div>
    </header>
  );
}
