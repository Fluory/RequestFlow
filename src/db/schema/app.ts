// Company-owned business data (schema `app`). Every table has `company_id` + RLS enabled AND forced
// (FORCE is added by a hand-written migration – drizzle-kit only emits ENABLE) with the policy
// `tenant_isolation` (ADR-0001 D7). Access only via `withTenant()` as `app_rw`.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgPolicy, pgSchema, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
      duplicateOfId: uuid("duplicate_of_id"),
      // Processing state (#7, ADR-0001 D4): visible cause, attempts and next retry for the request list.
      errorStage: text("error_stage").$type<"processing" | "export">(),
      errorMessage: text("error_message"),
      attempts: integer("attempts").default(0).notNull(),
      nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
      // Review decision (#8).
      rejectionReason: text("rejection_reason"),
    },
    (table) => [
      index("requests_company_id_idx").on(table.companyId),
      index("requests_company_message_id_idx").on(table.companyId, table.messageId),
      index("requests_company_fingerprint_idx").on(table.companyId, table.fingerprint),
      // FK checks bypass RLS: child rows pin company_id through composite keys.
      unique("requests_id_company_unique").on(table.id, table.companyId),
      foreignKey({
        name: "requests_duplicate_same_company_fk",
        columns: [table.duplicateOfId, table.companyId],
        foreignColumns: [table.id, table.companyId],
      }),
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
      requestId: uuid("request_id").notNull(),
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
      foreignKey({
        name: "documents_request_same_company_fk",
        columns: [table.requestId, table.companyId],
        foreignColumns: [requests.id, requests.companyId],
      }).onDelete("cascade"),
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

// One extraction run per processing job (#7): unique job_id makes a redelivered job a no-op.
// `documents` keeps per-document metadata (model, prompt/schema version, tokens, latency, warnings,
// or why a document was skipped) – no document content.
export const extractionRuns = appSchema
  .table(
    "extraction_runs",
    {
      id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
      companyId: uuid("company_id")
        .notNull()
        .references(() => organization.id, { onDelete: "restrict" }),
      requestId: uuid("request_id").notNull(),
      jobId: text("job_id").notNull().unique("extraction_runs_job_id_unique"),
      modelId: text("model_id"),
      promptVersion: text("prompt_version"),
      schemaVersion: text("schema_version"),
      totalTokens: integer("total_tokens"),
      latencyMs: integer("latency_ms"),
      documents: jsonb("documents").$type<Array<Record<string, unknown>>>().default([]).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      index("extraction_runs_request_idx").on(table.companyId, table.requestId, table.createdAt),
      unique("extraction_runs_id_company_unique").on(table.id, table.companyId),
      foreignKey({
        name: "extraction_runs_request_same_company_fk",
        columns: [table.requestId, table.companyId],
        foreignColumns: [requests.id, requests.companyId],
      }).onDelete("cascade"),
      tenantPolicy("extraction_runs"),
    ],
  )
  .enableRLS();

// Segments with stable locators, as returned by the AI service – the source view of the review UI.
export const extractionSegments = appSchema
  .table(
    "extraction_segments",
    {
      companyId: uuid("company_id").notNull(),
      runId: uuid("run_id").notNull(),
      documentId: uuid("document_id").notNull(),
      segmentId: text("segment_id").notNull(),
      position: integer("position").notNull(),
      text: text("text").notNull(),
      locator: jsonb("locator").$type<Record<string, unknown>>().notNull(),
    },
    (table) => [
      primaryKey({ name: "extraction_segments_pk", columns: [table.runId, table.documentId, table.segmentId] }),
      foreignKey({
        name: "extraction_segments_run_same_company_fk",
        columns: [table.runId, table.companyId],
        foreignColumns: [extractionRuns.id, extractionRuns.companyId],
      }).onDelete("cascade"),
      tenantPolicy("extraction_segments"),
    ],
  )
  .enableRLS();

// Extracted values after grounding verification. `status` found only if the AI service's verifier
// confirmed the quote (ADR-0001 D8); corrections (#8) are stored separately with audit.
export const extractedFields = appSchema
  .table(
    "extracted_fields",
    {
      id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
      companyId: uuid("company_id").notNull(),
      runId: uuid("run_id").notNull(),
      requestId: uuid("request_id").notNull(),
      fieldKey: text("field_key").notNull(),
      value: text("value"),
      status: text("status").$type<"found" | "uncertain" | "missing" | "unverified">().notNull(),
      modelStatus: text("model_status"),
      reason: text("reason"),
      documentId: uuid("document_id"),
      segmentId: text("segment_id"),
      quote: text("quote"),
    },
    (table) => [
      unique("extracted_fields_run_field_unique").on(table.runId, table.fieldKey),
      index("extracted_fields_request_idx").on(table.companyId, table.requestId),
      check("extracted_fields_status_check", sql`status in ('found', 'uncertain', 'missing', 'unverified')`),
      check("extracted_fields_found_has_evidence", sql`status <> 'found' or (quote is not null and segment_id is not null)`),
      foreignKey({
        name: "extracted_fields_run_same_company_fk",
        columns: [table.runId, table.companyId],
        foreignColumns: [extractionRuns.id, extractionRuns.companyId],
      }).onDelete("cascade"),
      foreignKey({
        name: "extracted_fields_request_same_company_fk",
        columns: [table.requestId, table.companyId],
        foreignColumns: [requests.id, requests.companyId],
      }).onDelete("cascade"),
      // Evidence must point at a segment stored with the same run (MATCH SIMPLE: no evidence → no check).
      foreignKey({
        name: "extracted_fields_evidence_segment_fk",
        columns: [table.runId, table.documentId, table.segmentId],
        foreignColumns: [extractionSegments.runId, extractionSegments.documentId, extractionSegments.segmentId],
      }),
      tenantPolicy("extracted_fields"),
    ],
  )
  .enableRLS();

// Corrections made during review (#8, DR2/DR6). Append-only like the audit trail: the current value
// of a field is its latest correction, else the extracted value. Old/new values are also written to
// `audit_events` in the same transaction.
export const fieldCorrections = appSchema
  .table(
    "field_corrections",
    {
      id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
      companyId: uuid("company_id").notNull(),
      requestId: uuid("request_id").notNull(),
      fieldKey: text("field_key").notNull(),
      oldValue: text("old_value"),
      newValue: text("new_value"),
      correctedBy: uuid("corrected_by").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      index("field_corrections_request_idx").on(table.companyId, table.requestId, table.fieldKey, table.createdAt),
      foreignKey({
        name: "field_corrections_request_same_company_fk",
        columns: [table.requestId, table.companyId],
        foreignColumns: [requests.id, requests.companyId],
      }).onDelete("cascade"),
      tenantPolicy("field_corrections"),
    ],
  )
  .enableRLS();

export const EXPORT_STATUSES = ["pending", "succeeded"] as const;

/**
 * One row per request that entered the export (#9, ADR-0001 D9). `unique(request_id)` is one of the
 * three exactly-once guards (with the idempotency key and the APPROVED → EXPORTED row lock).
 */
export const requestExports = appSchema
  .table(
    "request_exports",
    {
      id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
      companyId: uuid("company_id")
        .notNull()
        .references(() => organization.id, { onDelete: "restrict" }),
      requestId: uuid("request_id").notNull().unique("request_exports_request_id_unique"),
      idempotencyKey: uuid("idempotency_key").notNull(),
      status: text("status", { enum: EXPORT_STATUSES }).default("pending").notNull(),
      erpReference: text("erp_reference"),
      attempts: integer("attempts").default(0).notNull(),
      lastError: text("last_error"),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      exportedAt: timestamp("exported_at", { withTimezone: true }),
    },
    (table) => [
      check("request_exports_status_check", sql.raw(`status in (${EXPORT_STATUSES.map((s) => `'${s}'`).join(", ")})`)),
      check("request_exports_succeeded_has_reference", sql`status <> 'succeeded' or (erp_reference is not null and exported_at is not null)`),
      foreignKey({
        name: "request_exports_request_same_company_fk",
        columns: [table.requestId, table.companyId],
        foreignColumns: [requests.id, requests.companyId],
      }).onDelete("cascade"),
      tenantPolicy("request_exports"),
    ],
  )
  .enableRLS();
