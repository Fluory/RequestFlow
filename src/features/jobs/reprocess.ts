import { recordAudit } from "@/features/audit";
import { authorize, type Actor } from "@/features/identity";
import { lockRequest, transitionRequest } from "@/features/requests";
import type { Tenancy } from "@/features/tenancy";
import { enqueueRequestExport, enqueueRequestProcessing, type JobSender } from "./boss";

export class ReprocessRefused extends Error {
  constructor() {
    super("only requests in ERROR can be reprocessed");
    this.name = "ReprocessRefused";
  }
}

/**
 * Manual "reprocess" (ADR-0001 D4, D9): ERROR(processing) → NEW + processing job, ERROR(export) →
 * APPROVED + export job – in ONE transaction with the audit event. The export retry reuses the
 * request's idempotency key, so the ERP never creates a second record. The company comes from the
 * actor, never from input.
 */
export async function reprocessRequest(deps: { tenancy: Tenancy; boss: JobSender }, actor: Actor, requestId: string): Promise<void> {
  authorize(actor, "requests.process");
  await deps.tenancy.withTenant(actor.companyId, async (tx) => {
    const request = await lockRequest(tx, requestId);
    if (!request || request.status !== "ERROR" || (request.errorStage !== "processing" && request.errorStage !== "export")) throw new ReprocessRefused();
    const stage = request.errorStage;
    await transitionRequest(tx, request, stage === "export" ? "reprocess.export" : "reprocess.processing", { errorStage: null, errorMessage: null, nextRetryAt: null });
    if (stage === "export") await enqueueRequestExport(deps.boss, tx, requestId);
    else await enqueueRequestProcessing(deps.boss, tx, requestId);
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: "request.reprocessed",
      entityType: "request",
      entityId: requestId,
      data: { previousError: stage },
    });
  });
}
