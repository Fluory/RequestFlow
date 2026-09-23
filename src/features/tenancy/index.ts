// Public API of the `tenancy` module: tenant context and forced RLS (ADR-0001 D7).
export { createTenancy, tenantOf, MissingTenantError, type Tenancy, type TenantTx } from "./with-tenant";
