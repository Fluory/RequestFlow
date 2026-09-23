import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GLOBAL_APP_TABLES, TABLE_SECURITY_QUERY, tenantIsolationViolations, type TableSecurity } from "@/features/tenancy";

// Guard (#29, ADR-0001 D7): reads the real catalogue after all migrations. A new table in schema
// `app` without company_id + forced RLS + company policy fails `verify` – unless it is on the
// documented allow-list (empty by default).
describe("tenant isolation guard: every app table", () => {
  let owner: pg.Client;

  const violationsIn = async (client: pg.ClientBase) => {
    const { rows } = await client.query<TableSecurity>(TABLE_SECURITY_QUERY);
    return Object.fromEntries(
      rows.filter((row) => !Object.hasOwn(GLOBAL_APP_TABLES, row.table)).map((row) => [row.table, tenantIsolationViolations(row)] as const).filter(([, reasons]) => reasons.length > 0),
    );
  };

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
  });

  afterAll(async () => {
    await owner.end();
  });

  it("has company_id, forced row-level security and only company policies", async () => {
    const { rows } = await owner.query<TableSecurity>(TABLE_SECURITY_QUERY);
    // Sanity: the guard sees the real tables (a broken query must not pass with an empty list).
    expect(rows.map((row) => row.table)).toEqual(
      expect.arrayContaining(["audit_events", "documents", "extracted_fields", "extraction_runs", "extraction_segments", "field_corrections", "request_exports", "requests"]),
    );

    expect(await violationsIn(owner)).toEqual({});
  });

  it("keeps the allow-list of global tables documented and current: every entry names a reason and exists", async () => {
    const { rows } = await owner.query<{ table: string }>(TABLE_SECURITY_QUERY);
    for (const [table, reason] of Object.entries(GLOBAL_APP_TABLES)) {
      expect(reason.trim().length, table).toBeGreaterThan(10);
      expect(rows.map((row) => row.table), table).toContain(table);
    }
  });

  it("keeps data in known schemas only: app (guarded) plus the registered exceptions auth, pgboss, drizzle", async () => {
    const { rows } = await owner.query<{ schema: string }>(
      `select distinct n.nspname as schema from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p', 'm', 'f', 'v') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_toast%'
       order by 1`,
    );

    // A new schema (or a table in public) must be added here consciously – with a register entry
    // in docs/technical/architecture.md if it holds company data without RLS.
    expect(rows.map((row) => row.schema)).toEqual(["app", "auth", "drizzle", "pgboss"]);
  });

  it("fails for a deliberately unprotected table (proof that the guard bites)", async () => {
    await owner.query("begin");
    try {
      await owner.query("create table app.guard_probe (id uuid primary key, company_id uuid not null)");
      await owner.query("create table app.guard_probe_enabled (id uuid primary key, company_id uuid not null)");
      await owner.query("alter table app.guard_probe_enabled enable row level security");
      await owner.query("create policy guard_probe_enabled_all on app.guard_probe_enabled for all using (true)");
      await owner.query("create materialized view app.guard_probe_all_companies as select id, company_id from app.requests");
      await owner.query("create view app.guard_probe_view as select id from app.requests");

      const violations = await violationsIn(owner);

      const missing = expect.stringMatching(/^no company policy for ALL commands/);
      expect(violations).toEqual({
        guard_probe: ["row-level security not enabled", "row-level security not forced", missing],
        guard_probe_enabled: ["row-level security not forced", missing, "policy guard_probe_enabled_all is not a company policy"],
        guard_probe_all_companies: ["materialized view cannot carry row-level security"],
        guard_probe_view: ["view without security_invoker bypasses row-level security"],
      });
    } finally {
      await owner.query("rollback");
    }
  });

  it("runs the application as app_rw: no BYPASSRLS, not superuser, owns no app table, not a member of the owner role", async () => {
    const { rows } = await owner.query(
      `select r.rolbypassrls as bypass, r.rolsuper as super,
              (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relowner = r.oid) as owned,
              pg_has_role('app_rw', 'app_owner', 'member') as "ownerMember"
       from pg_roles r where r.rolname = 'app_rw'`,
    );
    const runtime = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await runtime.connect();
    const { rows: who } = await runtime.query<{ user: string }>('select current_user as "user"');
    await runtime.end();

    expect(rows[0]).toEqual({ bypass: false, super: false, owned: 0, ownerMember: false });
    expect(who[0]?.user).toBe("app_rw");
  });
});
