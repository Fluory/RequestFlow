import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

// Permissions of the Better Auth organization plugin's own HTTP endpoints (/api/auth/organization/*).
// Members and invitations are managed ONLY through the `identity` module (#30: audited, last-admin
// rule), so the plugin endpoints grant nobody member or invitation rights. Deleting the organization
// (= company) is nobody's right in the pilot.
export const organizationAc = createAccessControl(defaultStatements);

export const organizationRoles = {
  admin: organizationAc.newRole({
    organization: ["update"],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
  clerk: organizationAc.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
};

// The organization plugin serves the data model (companies, members, invitations) and `set-active`
// only. Every other /organization/* endpoint is disabled (404): members, invitations and the company
// itself change only through the audited `identity` module (#30). Found in the #30 security review:
// e.g. `/organization/leave` has no permission check and would let the last admin leave unaudited,
// `/organization/list-members` lets any member (clerks too) read all colleagues.
const ORGANIZATION_ENDPOINTS = [
  "accept-invitation", "add-team-member", "cancel-invitation", "check-slug", "create", "create-role", "create-team", "delete",
  "delete-role", "get-active-member", "get-active-member-role", "get-full-organization", "get-invitation", "get-organization",
  "get-role", "invite-member", "leave", "list", "list-invitations", "list-members", "list-roles", "list-team-members",
  "list-teams", "list-user-invitations", "list-user-teams", "reject-invitation", "remove-member", "remove-team",
  "remove-team-member", "set-active-team", "update", "update-member-role", "update-role", "update-team",
] as const;
export const DISABLED_AUTH_PATHS = ORGANIZATION_ENDPOINTS.map((endpoint) => `/organization/${endpoint}`);

// Global roles of the Better Auth admin plugin. Every app user is `user` (no admin-plugin rights);
// `platform-admin` exists only so the plugin has an admin role – nobody holds it in the pilot.
export const PLATFORM_ADMIN_ROLE = "platform-admin";
export const platformRoles = { user: userAc, [PLATFORM_ADMIN_ROLE]: adminAc };
