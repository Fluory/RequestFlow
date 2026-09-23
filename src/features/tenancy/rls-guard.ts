// Guard (#29, ADR-0001 D7): every table in schema `app` must carry `company_id`, have row-level
// security enabled AND forced, and only company policies – so a new table can never silently skip
// tenant isolation. Run by tests/integration/rls-guard.test.ts in `verify`.

/**
 * Tables in schema `app` that are deliberately global (no tenant isolation). Empty by default; every
 * entry needs a reason and an entry in the exceptions register (docs/technical/architecture.md).
 */
export const GLOBAL_APP_TABLES: Readonly<Record<string, string>> = {};

export interface TableSecurity {
  table: string;
  /** pg_class.relkind: r table, p partitioned table, m materialized view, f foreign table, v view. */
  kind: "r" | "p" | "m" | "f" | "v";
  /** Views only: `security_invoker=true` applies the caller's RLS of the underlying tables. */
  securityInvoker: boolean;
  rlsEnabled: boolean;
  rlsForced: boolean;
  companyIdNotNull: boolean;
  policies: Array<{ name: string; permissive: boolean; command: string; using: string | null; withCheck: string | null }>;
}

/**
 * The only accepted policy expression: the row's company equals the transaction's company – as
 * PostgreSQL deparses `tenantPolicy()`/`currentCompany` (src/db/schema/app.ts) into pg_policies.
 * Change both together; a mismatch fails the guard with the expected expression in the message.
 */
const TENANT_EXPRESSION = "(company_id = (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid)";
const isTenantExpression = (expression: string | null) => expression !== null && expression.trim() === TENANT_EXPRESSION;

/**
 * Why a table violates tenant isolation – empty when it is protected. A permissive policy with any
 * other expression would widen access (permissive policies are OR-ed), so every policy must match.
 */
export function tenantIsolationViolations(table: TableSecurity): string[] {
  const reasons: string[] = [];
  // Materialized views and foreign tables cannot carry RLS; a view leaks unless it runs with the
  // caller's rights (security_invoker) – so these are refused unless allow-listed.
  if (table.kind === "m" || table.kind === "f") return [`${table.kind === "m" ? "materialized view" : "foreign table"} cannot carry row-level security`];
  if (table.kind === "v") return table.securityInvoker ? [] : ["view without security_invoker bypasses row-level security"];
  if (!table.companyIdNotNull) reasons.push("no NOT NULL company_id column");
  if (!table.rlsEnabled) reasons.push("row-level security not enabled");
  if (!table.rlsForced) reasons.push("row-level security not forced");
  if (!table.policies.some((policy) => policy.permissive && policy.command === "ALL" && isTenantExpression(policy.using) && (policy.withCheck === null || isTenantExpression(policy.withCheck)))) {
    reasons.push(`no company policy for ALL commands (expected USING ${TENANT_EXPRESSION})`);
  }
  // Deliberately strict: also a restrictive or INSERT-only policy with another expression is reported
  // (fail-safe false positive – loosen consciously in code, not by accident).
  for (const policy of table.policies) {
    if (!isTenantExpression(policy.using) || (policy.withCheck !== null && !isTenantExpression(policy.withCheck))) {
      reasons.push(`policy ${policy.name} is not a company policy`);
    }
  }
  return reasons;
}

/** Catalogue query (pg_class, pg_attribute, pg_policies) for every table, view and foreign table of `app`. */
export const TABLE_SECURITY_QUERY = `
  select c.relname as "table",
         c.relkind as "kind",
         coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false) as "securityInvoker",
         c.relrowsecurity as "rlsEnabled",
         c.relforcerowsecurity as "rlsForced",
         exists (
           select 1 from pg_attribute a
           where a.attrelid = c.oid and a.attname = 'company_id' and a.attnotnull and not a.attisdropped
         ) as "companyIdNotNull",
         coalesce((
           select json_agg(json_build_object(
             'name', p.policyname, 'permissive', p.permissive = 'PERMISSIVE', 'command', p.cmd,
             'using', p.qual, 'withCheck', p.with_check) order by p.policyname)
           from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname
         ), '[]'::json) as "policies"
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relkind in ('r', 'p', 'm', 'f', 'v')
  order by c.relname`;
