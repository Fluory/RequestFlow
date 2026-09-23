// Company-owned business data (schema `app`). Every table has `company_id` + RLS enabled AND forced
// (FORCE is added by a hand-written migration – drizzle-kit only emits ENABLE) with the policy
// `tenant_isolation` (ADR-0001 D7). Access only via `withTenant()` as `app_rw`.
import { sql } from "drizzle-orm";
import { check, index, pgPolicy, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const appSchema = pgSchema("app");

/** `app.company_id` is set transaction-locally by `withTenant()`; unset → NULL → no row matches. */
export const currentCompany = sql`nullif(current_setting('app.company_id', true), '')::uuid`;

export const tenantPolicy = (table: string) =>
  pgPolicy(`${table}_tenant_isolation`, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`company_id = ${currentCompany}`,
    withCheck: sql`company_id = ${currentCompany}`,
  });

export const REQUEST_STATUSES = ["NEW", "PROCESSING", "REVIEW", "APPROVED", "EXPORTED", "REJECTED", "ERROR"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// Minimal request aggregate – the first tenant table (#4). #5 and #7 extend it additively.
export const requests = appSchema
  .table(
    "requests",
    {
      id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
      companyId: uuid("company_id")
        .notNull()
        .references(() => organization.id, { onDelete: "restrict" }),
      status: text("status").$type<RequestStatus>().default("NEW").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      index("requests_company_id_idx").on(table.companyId),
      check("requests_status_check", sql.raw(`status in (${REQUEST_STATUSES.map((s) => `'${s}'`).join(", ")})`)),
      tenantPolicy("requests"),
    ],
  )
  .enableRLS();
