import { createAccessControl } from "better-auth/plugins/access";
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
