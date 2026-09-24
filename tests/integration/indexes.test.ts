import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// #61: the request list pages by (created_at desc, id desc) within one company (#48). The index must
// match that order, so a page is read from the index instead of sorting all of the company's requests.
describe("indexes: request list keyset paging", () => {
  let owner: pg.Client;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
  });

  afterAll(async () => {
    await owner.end();
  });

  it("has an index on (company_id, created_at desc, id desc)", async () => {
    const { rows } = await owner.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'app' and tablename = 'requests' and indexname = 'requests_company_created_idx'",
    );
    expect(rows.map((row) => row.indexdef)).toEqual([
      "CREATE INDEX requests_company_created_idx ON app.requests USING btree (company_id, created_at DESC, id DESC)",
    ]);
  });

  it("lets the planner read a page of one company from that index without a sort", async () => {
    await owner.query("begin");
    try {
      // Tiny test tables favour a sequential scan; switching it off shows whether the index can serve
      // the query in its order (no Sort node) – the property that matters once the table is large.
      await owner.query("set local enable_seqscan = off");
      const { rows } = await owner.query<{ "QUERY PLAN": string }>(
        `explain select * from app.requests where company_id = '00000000-0000-0000-0000-000000000001'
           order by created_at desc, id desc limit 51`,
      );
      const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(plan).toContain("requests_company_created_idx");
      expect(plan).not.toMatch(/\bSort\b/);
    } finally {
      await owner.query("rollback");
    }
  });
});
