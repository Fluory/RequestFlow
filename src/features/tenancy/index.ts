// Public API of the `tenancy` module: tenant context and forced RLS (ADR-0001 D7).
export { createTenancy, tenantOf, MissingTenantError, type Tenancy, type TenantTx } from "./with-tenant";
export { GLOBAL_APP_TABLES, TABLE_SECURITY_QUERY, tenantIsolationViolations, type TableSecurity } from "./rls-guard";
