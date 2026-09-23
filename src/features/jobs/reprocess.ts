import { recordAudit } from "@/features/audit";
import { authorize, type Actor } from "@/features/identity";
import { lockRequest, transitionRequest } from "@/features/requests";
import type { Tenancy } from "@/features/tenancy";
import { enqueueRequestProcessing, type JobSender } from "./boss";

export class ReprocessRefused extends Error {
  constructor() {
    super("only requests in ERROR (stage processing) can be reprocessed");
    this.name = "ReprocessRefused";
  }
}

/**
 * Manual "reprocess" (ADR-0001 D4): ERROR(processing) → NEW and a new job, in ONE transaction with
 * the audit event. The company comes from the actor, never from input.
 */
export async function reprocessRequest(deps: { tenancy: Tenancy; boss: JobSender }, actor: Actor, requestId: string): Promise<void> {
  authorize(actor, "requests.process");
  await deps.tenancy.withTenant(actor.companyId, async (tx) => {
    const request = await lockRequest(tx, requestId);
    if (!request || request.status !== "ERROR" || request.errorStage !== "processing") throw new ReprocessRefused();
    await transitionRequest(tx, request, "reprocess.processing", { errorStage: null, errorMessage: null, nextRetryAt: null });
    await enqueueRequestProcessing(deps.boss, tx, requestId);
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: "request.reprocessed",
      entityType: "request",
      entityId: requestId,
      data: { previousError: "processing" },
    });
  });
}
