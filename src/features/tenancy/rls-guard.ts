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
  rlsEnabled: boolean;
  rlsForced: boolean;
  companyIdNotNull: boolean;
  policies: Array<{ name: string; permissive: boolean; command: string; using: string | null; withCheck: string | null }>;
}

/** The only accepted policy expression: the row's company equals the transaction's company. */
// As PostgreSQL deparses it into pg_policies (whitespace-exact).
const TENANT_EXPRESSION = "(company_id = (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid)";
const isTenantExpression = (expression: string | null) => expression !== null && expression.trim() === TENANT_EXPRESSION;

/**
 * Why a table violates tenant isolation – empty when it is protected. A permissive policy with any
 * other expression would widen access (permissive policies are OR-ed), so every policy must match.
 */
export function tenantIsolationViolations(table: TableSecurity): string[] {
  const reasons: string[] = [];
  if (!table.companyIdNotNull) reasons.push("no NOT NULL company_id column");
  if (!table.rlsEnabled) reasons.push("row-level security not enabled");
  if (!table.rlsForced) reasons.push("row-level security not forced");
  if (!table.policies.some((policy) => policy.permissive && policy.command === "ALL" && isTenantExpression(policy.using) && (policy.withCheck === null || isTenantExpression(policy.withCheck)))) {
    reasons.push("no company policy for ALL commands");
  }
  for (const policy of table.policies) {
    if (!isTenantExpression(policy.using) || (policy.withCheck !== null && !isTenantExpression(policy.withCheck))) {
      reasons.push(`policy ${policy.name} is not a company policy`);
    }
  }
  return reasons;
}

/** Catalogue query (pg_class, pg_attribute, pg_policies) for all ordinary and partitioned tables of `app`. */
export const TABLE_SECURITY_QUERY = `
  select c.relname as "table",
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
  where n.nspname = 'app' and c.relkind in ('r', 'p')
  order by c.relname`;
