import Link from "next/link";
import { headers } from "next/headers";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { getCompany } from "@/features/identity";
import { SignOutButton } from "./auth-form";
import { NavLink } from "./nav-link";

const ROLE_LABEL = { admin: "Administration", clerk: "Sachbearbeitung" } as const;

// App shell (#52): brand on every page; navigation, company, role and sign-out only when signed in.
// Navigation mirrors the server-side permissions – it hides links, it never grants access.
export async function AppHeader() {
  const actor = await currentActor(await headers());
  const company = actor ? await getCompany(getRuntime().database.db, actor.companyId) : null;
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
        {actor && (
          <>
            <nav className="app-nav" aria-label="Hauptnavigation">
              <NavLink href="/requests">Anfragen</NavLink>
              {actor.role === "admin" && <NavLink href="/users">Benutzer</NavLink>}
            </nav>
            <div className="account">
              <span>
                <strong>{company?.name}</strong> · Rolle: {ROLE_LABEL[actor.role]}
              </span>
              <SignOutButton />
            </div>
          </>
        )}
      </div>
    </header>
  );
}
