import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

// Permissions of the Better Auth organization plugin's own HTTP endpoints (/api/auth/organization/*).
// They mirror `authorize()`: only company admins invite or change members; clerks get nothing.
// Deleting the organization (= company) is nobody's right in the pilot.
export const organizationAc = createAccessControl(defaultStatements);

export const organizationRoles = {
  admin: organizationAc.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
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

// Global roles of the Better Auth admin plugin. Every app user is `user` (no admin-plugin rights);
// `platform-admin` exists only so the plugin has an admin role – nobody holds it in the pilot.
export const PLATFORM_ADMIN_ROLE = "platform-admin";
export const platformRoles = { user: userAc, [PLATFORM_ADMIN_ROLE]: adminAc };
