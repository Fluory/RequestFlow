import { describe, expect, it } from "vitest";
import { tenantIsolationViolations, type TableSecurity } from "./rls-guard";

const TENANT = "(company_id = (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid)";
const protectedTable = (overrides: Partial<TableSecurity> = {}): TableSecurity => ({
  table: "things",
  kind: "r",
  securityInvoker: false,
  rlsEnabled: true,
  rlsForced: true,
  companyIdNotNull: true,
  policies: [{ name: "things_tenant_isolation", permissive: true, command: "ALL", using: TENANT, withCheck: TENANT }],
  ...overrides,
});

describe("tenant isolation rules (#29)", () => {
  it("accepts a table with company_id, forced RLS and the company policy", () => {
    expect(tenantIsolationViolations(protectedTable())).toEqual([]);
    expect(tenantIsolationViolations(protectedTable({ policies: [{ name: "p", permissive: true, command: "ALL", using: TENANT, withCheck: null }] }))).toEqual([]);
  });

  it("reports RLS that is off or only enabled, not forced", () => {
    expect(tenantIsolationViolations(protectedTable({ rlsEnabled: false, rlsForced: false }))).toEqual(["row-level security not enabled", "row-level security not forced"]);
    expect(tenantIsolationViolations(protectedTable({ rlsForced: false }))).toEqual(["row-level security not forced"]);
  });

  it("reports a missing company policy and a policy for only some commands", () => {
    const missing = `no company policy for ALL commands (expected USING ${TENANT})`;
    expect(tenantIsolationViolations(protectedTable({ policies: [] }))).toEqual([missing]);
    expect(tenantIsolationViolations(protectedTable({ policies: [{ name: "sel", permissive: true, command: "SELECT", using: TENANT, withCheck: null }] }))).toEqual([missing]);
  });

  it("reports any extra policy with another expression – permissive policies are OR-ed and would widen access", () => {
    const wide = { name: "everyone", permissive: true, command: "SELECT", using: "true", withCheck: null };
    expect(tenantIsolationViolations(protectedTable({ policies: [...protectedTable().policies, wide] }))).toEqual(["policy everyone is not a company policy"]);
    const looseCheck = { name: "loose", permissive: true, command: "ALL", using: TENANT, withCheck: "true" };
    expect(tenantIsolationViolations(protectedTable({ policies: [looseCheck] }))).toEqual([
      `no company policy for ALL commands (expected USING ${TENANT})`,
      "policy loose is not a company policy",
    ]);
  });

  it("refuses materialized views and foreign tables, and views unless they run with the caller's rights", () => {
    expect(tenantIsolationViolations(protectedTable({ kind: "m", policies: [] }))).toEqual(["materialized view cannot carry row-level security"]);
    expect(tenantIsolationViolations(protectedTable({ kind: "f", policies: [] }))).toEqual(["foreign table cannot carry row-level security"]);
    expect(tenantIsolationViolations(protectedTable({ kind: "v", policies: [] }))).toEqual(["view without security_invoker bypasses row-level security"]);
    expect(tenantIsolationViolations(protectedTable({ kind: "v", securityInvoker: true, policies: [] }))).toEqual([]);
  });

  it("reports a table without a NOT NULL company_id", () => {
    expect(tenantIsolationViolations(protectedTable({ companyIdNotNull: false }))).toEqual(["no NOT NULL company_id column"]);
  });
});
