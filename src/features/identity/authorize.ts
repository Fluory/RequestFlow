// Company roles and the single authorization decision (ADR-0001 D7). The role lives on the
// membership (Better Auth `member.role`), never on the global user – a company admin has no rights
// outside their own company.
export const COMPANY_ROLES = ["admin", "clerk", "guest"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];
/** Roles an admin may invite or assign. `guest` is only ever created by the guest access (#126). */
export const STAFF_ROLES = ["admin", "clerk"] as const satisfies readonly CompanyRole[];

export interface Actor {
  userId: string;
  companyId: string;
  role: CompanyRole;
  /** Display name from the session – for the UI only, never for authorization. */
  name?: string;
}

// `requests.ingest`: everything that sends files to the live AI model – own uploads and reprocessing an
// extraction (#126). Guests of the public showcase review, correct, approve and export the prepared
// samples (recorded answers), but never start a paid model call.
export type Action = "requests.process" | "requests.ingest" | "users.invite" | "users.manage";

const PERMISSIONS: Record<CompanyRole, ReadonlySet<Action>> = {
  admin: new Set<Action>(["requests.process", "requests.ingest", "users.invite", "users.manage"]),
  clerk: new Set<Action>(["requests.process", "requests.ingest"]),
  guest: new Set<Action>(["requests.process"]),
};

export class AuthorizationError extends Error {
  constructor(readonly action: Action) {
    super(`not allowed: ${action}`);
    this.name = "AuthorizationError";
  }
}

export function isCompanyRole(value: unknown): value is CompanyRole {
  return typeof value === "string" && (COMPANY_ROLES as readonly string[]).includes(value);
}

/** Throws unless the actor may perform the action. Unknown roles and missing companies fail closed. */
export function authorize(actor: Actor, action: Action): void {
  if (!actor.companyId || !isCompanyRole(actor.role) || !PERMISSIONS[actor.role].has(action)) {
    throw new AuthorizationError(action);
  }
}
