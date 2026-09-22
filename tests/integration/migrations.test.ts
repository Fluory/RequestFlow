import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The global setup has already applied every migration as app_owner.
describe("first migration", () => {
  let rw: pg.Client;

  beforeAll(async () => {
    rw = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await rw.connect();
  });

  afterAll(async () => {
    await rw.end();
  });

  it("runtime role app_rw cannot bypass RLS, is no superuser and cannot create roles", async () => {
    const { rows } = await rw.query(
      "select current_user as name, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = current_user",
    );

    expect(rows[0]).toEqual({ name: "app_rw", rolsuper: false, rolbypassrls: false, rolcreaterole: false });
  });

  it("schema app is owned by app_owner", async () => {
    const { rows } = await rw.query(
      "select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'app'",
    );

    expect(rows[0]?.owner).toBe("app_owner");
  });

  it("app_rw may use schema app but never create objects in it", async () => {
    const { rows } = await rw.query(
      "select has_schema_privilege('app', 'USAGE') as usage, has_schema_privilege('app', 'CREATE') as create",
    );
    expect(rows[0]).toEqual({ usage: true, create: false });

    await expect(rw.query("create table app.sneaky (id int)")).rejects.toThrow(/permission denied/);
  });

  it("tables created later by app_owner are readable and writable by app_rw (default privileges)", async () => {
    const { rows } = await rw.query(
      `select defaclobjtype as kind, array_to_string(defaclacl, ',') as acl
         from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
        where n.nspname = 'app' and pg_get_userbyid(d.defaclrole) = 'app_owner'
        order by 1`,
    );
    const tables = rows.find((row) => row.kind === "r");

    expect(tables?.acl).toMatch(/app_rw=arwd\/app_owner/);
  });
});
