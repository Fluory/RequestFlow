import type { CompanyRole } from "./authorize";

// Last-admin rule (#30): a company must always keep at least one ACTIVE admin – otherwise nobody
// could manage its users any more (there is no cross-company administration in the pilot).
export interface MemberState {
  userId: string;
  role: CompanyRole;
  active: boolean;
}

export type MemberChange = { userId: string; role: CompanyRole } | { userId: string; active: boolean };

export class LastAdminError extends Error {
  constructor() {
    super("the last active admin of a company cannot be demoted or deactivated");
    this.name = "LastAdminError";
  }
}

export function assertAdminRemains(members: MemberState[], change: MemberChange): void {
  const after = members.map((member) => (member.userId === change.userId ? { ...member, ...change } : member));
  if (!after.some((member) => member.role === "admin" && member.active)) throw new LastAdminError();
}
