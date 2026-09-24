import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getRuntime, requestActor } from "@/app/_server/runtime";
import { getCompany, type Actor } from "@/features/identity";
import { logEvent } from "@/features/observability";
import { SignOutButton } from "./auth-form";
import { NavLink } from "./nav-link";

export const ROLE_LABEL = { admin: "Administration", clerk: "Sachbearbeitung" } as const;

async function signedIn(): Promise<{ actor: Actor; companyName: string | undefined } | null> {
  try {
    const actor = await requestActor();
    if (!actor) return null;
    const company = await getCompany(getRuntime().database.db, actor.companyId);
    return { actor, companyName: company?.name };
  } catch (error) {
    unstable_rethrow(error); // Next.js control flow (dynamic rendering, redirects) is not a failure.
    // The header must never take a page down (e.g. database unreachable): render no header.
    logEvent("error", "app_header.failed", {}, { code: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

/** The brand mark + name – also used above the sign-in cards. */
export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={className ? `brand ${className}` : "brand"}>
      <span className="brand-mark" aria-hidden="true" />
      RequestFlow
    </Link>
  );
}

// App shell (#52, design prototype A): only for signed-in users – sign-in pages show the brand in the
// card instead. Navigation mirrors the server-side permissions; it hides links, it never grants access.
export async function AppHeader() {
  const session = await signedIn();
  if (!session) return null;
  const { actor, companyName } = session;
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Brand />
        <nav className="app-nav" aria-label="Hauptnavigation">
          <NavLink href="/requests">Anfragen</NavLink>
          {actor.role === "admin" && <NavLink href="/users" also={["/invite"]}>Benutzer</NavLink>}
        </nav>
        <div className="account">
          <div className="account-who">
            <div className="account-company">{companyName}</div>
            <div className="account-person">
              {actor.name ? `${actor.name} · ` : ""}Rolle: {ROLE_LABEL[actor.role]}
            </div>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
