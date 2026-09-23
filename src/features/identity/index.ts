// Public API of the `identity` module: Better Auth, companies, company roles (ADR-0001 D6/D7).
export { createAuth, type Auth, type AuthSettings } from "./auth";
export { getActor } from "./actor";
export { bootstrapCompany, getCompany, inviteUser, type Company } from "./companies";
export { changeUserRole, listCompanyUsers, setUserActive, UserNotInCompany, type CompanyUser, type PendingInvitation } from "./users";
export { assertAdminRemains, LastAdminError, type MemberChange, type MemberState } from "./last-admin";
export { authorize, AuthorizationError, isCompanyRole, COMPANY_ROLES, type Action, type Actor, type CompanyRole } from "./authorize";
