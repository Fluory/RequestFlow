import { and, asc, eq } from "drizzle-orm";
import { auditEvents } from "@/db/schema";
import { tenantOf, type TenantTx } from "@/features/tenancy";

// Business audit (ADR-0001 D10, DR6): written in the caller's transaction, so the change and its
// audit event commit or roll back together. The database allows INSERT/SELECT only.
export interface AuditEventInput {
  actorUserId: string | null;
  action: string;
  entityType: "request" | "document" | "user" | "invitation";
  entityId: string;
  data?: Record<string, unknown>;
}

export async function recordAudit(tx: TenantTx, event: AuditEventInput): Promise<void> {
  await tx.insert(auditEvents).values({ companyId: tenantOf(tx), ...event, data: event.data ?? {} });
}

export async function listAuditEvents(tx: TenantTx, entityType: AuditEventInput["entityType"], entityId: string) {
  tenantOf(tx);
  return tx
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
    .orderBy(asc(auditEvents.createdAt));
}
