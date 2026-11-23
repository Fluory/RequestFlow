// Guest admissions of the showcase (schema `identity`, next to the Better Auth tables – kept in its own
// file so a Better Auth regeneration of ./auth.ts never drops it). One row per guest company: when it was
// created and a keyed hash of the client address (never the address itself). It backs the atomic daily
// cap and the per-client brake (src/features/identity/guests.ts) and goes with the company (cascade)
// when the guest retention deletes it. Not company-owned business data → no RLS (exceptions register).
import { index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authSchema, organization } from "./auth";

export const guestAdmission = authSchema.table(
  "guest_admission",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientKey: text("client_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("guest_admission_created_at_idx").on(table.createdAt), index("guest_admission_client_idx").on(table.clientKey, table.createdAt)],
);
