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
      // The planner's choice depends on the test table's size and statistics. Discouraging sequential
      // scans, bitmap scans and sorts asks a stable question instead: CAN the index serve the query in
      // its order? If it cannot, the plan still contains a Sort node (the switches only raise costs).
      await owner.query("set local enable_seqscan = off");
      await owner.query("set local enable_bitmapscan = off");
      await owner.query("set local enable_sort = off");
      const explain = async (query: string) =>
        (await owner.query<{ "QUERY PLAN": string }>(`explain ${query}`)).rows.map((row) => row["QUERY PLAN"]).join("\n");
      const company = "'00000000-0000-0000-0000-000000000001'";
      const first = await explain(`select * from app.requests where company_id = ${company} order by created_at desc, id desc limit 51`);
      expect(first).toContain("requests_company_created_idx");
      expect(first).not.toMatch(/\bSort\b/);
      // A following page seeks with the row comparison of #48: it must be part of the index condition
      // (a range scan from the cursor), not a filter over all of the company's rows.
      const next = await explain(
        `select * from app.requests where company_id = ${company}
           and (created_at, id) < ('2026-09-24T12:00:00Z'::timestamptz, '00000000-0000-0000-0000-000000000009'::uuid)
           order by created_at desc, id desc limit 51`,
      );
      expect(next).toContain("requests_company_created_idx");
      expect(next).not.toMatch(/\bSort\b/);
      expect(next).toMatch(/Index Cond: .*ROW\(created_at, id\) < ROW/);
    } finally {
      await owner.query("rollback");
    }
  });
});
