import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "@/db";
import { bootstrapCompany } from "@/features/identity";
import { createRequest, listRequests } from "@/features/requests";
import { createTenancy, MissingTenantError, type Tenancy, type TenantTx } from "@/features/tenancy";
import { unique } from "./helpers/stack";

// Two synthetic companies, A and B. Proof of ADR-0001 D7 on both layers: repository and raw SQL as app_rw.
describe("tenancy: withTenant and forced RLS", () => {
  let database: DatabaseHandle;
  let tenancy: Tenancy;
  let companyA: string;
  let companyB: string;

  beforeAll(async () => {
    database = createDatabase(process.env.DATABASE_URL!, { max: 4 });
    tenancy = createTenancy(database.db);
    const a = await bootstrapCompany(database.db, { name: "Firma A (synthetisch)", slug: unique("a"), adminEmail: `${unique("a")}@example.com` });
    const b = await bootstrapCompany(database.db, { name: "Firma B (synthetisch)", slug: unique("b"), adminEmail: `${unique("b")}@example.com` });
    companyA = a.company.id;
    companyB = b.company.id;
    await tenancy.withTenant(companyA, (tx) => createRequest(tx));
    await tenancy.withTenant(companyB, (tx) => createRequest(tx));
  });

  afterAll(async () => {
    await database.pool.end();
  });

  it("returns only the own company's requests through the repository", async () => {
    const { rows: rowsA } = await tenancy.withTenant(companyA, (tx) => listRequests(tx));
    const { rows: rowsB } = await tenancy.withTenant(companyB, (tx) => listRequests(tx));

    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((row) => row.companyId === companyA)).toBe(true);
    expect(rowsB.every((row) => row.companyId === companyB)).toBe(true);
  });

  describe("raw SQL as app_rw", () => {
    let client: pg.Client;

    beforeAll(async () => {
      client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client.end();
    });

    it("sees only company A with app.company_id = A, even without a WHERE clause", async () => {
      await client.query("begin");
      await client.query("select set_config('app.company_id', $1, true)", [companyA]);
      const { rows } = await client.query("select distinct company_id from app.requests");
      await client.query("commit");

      expect(rows.map((row) => row.company_id)).toEqual([companyA]);
    });

    it("sees no rows at all without a company context", async () => {
      const { rows } = await client.query("select count(*)::int as n from app.requests");

      expect(rows[0].n).toBe(0);
    });

    it("rejects inserting a row of company B while acting for company A", async () => {
      await client.query("begin");
      await client.query("select set_config('app.company_id', $1, true)", [companyA]);
      const insert = client.query("insert into app.requests (company_id) values ($1)", [companyB]);

      await expect(insert).rejects.toThrow(/row-level security/);
      await client.query("rollback");
    });

    it("cannot move an own row to another company", async () => {
      await client.query("begin");
      await client.query("select set_config('app.company_id', $1, true)", [companyA]);
      const update = client.query("update app.requests set company_id = $1", [companyB]);

      await expect(update).rejects.toThrow(/row-level security/);
      await client.query("rollback");
    });
  });

  it("keeps the company setting transaction-local: a reused pooled connection has none", async () => {
    const single = createDatabase(process.env.DATABASE_URL!, { max: 1 });
    try {
      await createTenancy(single.db).withTenant(companyA, (tx) => listRequests(tx));

      const { rows } = await single.pool.query(
        "select coalesce(current_setting('app.company_id', true), '') as company, (select count(*)::int from app.requests) as n",
      );
      expect(rows[0]).toEqual({ company: "", n: 0 });
    } finally {
      await single.pool.end();
    }
  });

  it("has RLS enabled and forced on app.requests", async () => {
    const { rows } = await database.pool.query(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'app.requests'::regclass",
    );

    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("refuses repository calls without a tenant transaction", async () => {
    const plain = await database.db.transaction(async (tx) => listRequests(tx as TenantTx).catch((error: unknown) => error));

    expect(plain).toBeInstanceOf(MissingTenantError);
  });

  it("refuses a company id that is not a UUID", async () => {
    await expect(tenancy.withTenant("' or 1=1 --", (tx) => listRequests(tx))).rejects.toThrow(MissingTenantError);
  });
});
