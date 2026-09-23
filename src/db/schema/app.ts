// Company-owned business data (schema `app`). Every table has `company_id` + RLS enabled AND forced
// (FORCE is added by a hand-written migration – drizzle-kit only emits ENABLE) with the policy
// `tenant_isolation` (ADR-0001 D7). Access only via `withTenant()` as `app_rw`.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, boolean, check, index, jsonb, pgPolicy, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
      // Intake (#5): who uploaded, what arrived, duplicate fingerprint (ADR-0001 D9).
      source: text("source").$type<"upload">().default("upload").notNull(),
      createdBy: uuid("created_by"),
      subject: text("subject"),
      messageId: text("message_id"),
      fingerprint: text("fingerprint"),
      possibleDuplicate: boolean("possible_duplicate").default(false).notNull(),
      duplicateOfId: uuid("duplicate_of_id").references((): AnyPgColumn => requests.id, { onDelete: "set null" }),
    },
    (table) => [
      index("requests_company_id_idx").on(table.companyId),
      index("requests_company_message_id_idx").on(table.companyId, table.messageId),
      index("requests_company_fingerprint_idx").on(table.companyId, table.fingerprint),
      check("requests_status_check", sql.raw(`status in (${REQUEST_STATUSES.map((s) => `'${s}'`).join(", ")})`)),
      tenantPolicy("requests"),
    ],
  )
  .enableRLS();

// Originals of a request (mail or loose files). Bytes live in private object storage under
// `{companyId}/{requestId}/{documentId}`; the row keeps the reference and the SHA-256.
export const documents = appSchema
  .table(
    "documents",
    {
      id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
      companyId: uuid("company_id")
        .notNull()
        .references(() => organization.id, { onDelete: "restrict" }),
      requestId: uuid("request_id")
        .notNull()
        .references(() => requests.id, { onDelete: "cascade" }),
      filename: text("filename").notNull(),
      contentType: text("content_type").notNull(),
      kind: text("kind").$type<DocumentKind>().notNull(),
      sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
      sha256: text("sha256").notNull(),
      storageKey: text("storage_key").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      index("documents_company_id_idx").on(table.companyId),
      index("documents_request_id_idx").on(table.requestId),
      check("documents_kind_check", sql.raw(`kind in (${DOCUMENT_KINDS.map((k) => `'${k}'`).join(", ")})`)),
      tenantPolicy("documents"),
    ],
  )
  .enableRLS();

export const DOCUMENT_KINDS = ["eml", "msg", "pdf", "xlsx", "docx"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// Append-only business audit (ADR-0001 D10): written in the same transaction as the change;
// app_rw has INSERT and SELECT only (hand-written migration revokes UPDATE/DELETE).
export const auditEvents = appSchema
  .table(
    "audit_events",
    {
      id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
      companyId: uuid("company_id")
        .notNull()
        .references(() => organization.id, { onDelete: "restrict" }),
      actorUserId: uuid("actor_user_id"),
      action: text("action").notNull(),
      entityType: text("entity_type").notNull(),
      entityId: uuid("entity_id").notNull(),
      data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [index("audit_events_entity_idx").on(table.companyId, table.entityType, table.entityId), tenantPolicy("audit_events")],
  )
  .enableRLS();
