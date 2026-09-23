import { sendInTransaction, type JobSender } from "@/db/job-queue";
import { tenantOf, type TenantTx } from "@/features/tenancy";
import { QUEUES, type RequestJob } from "./queues";

export type { JobSender };

/**
 * Enqueues processing of a request IN the caller's tenant transaction: the job exists exactly when
 * the request row commits. Payload: IDs only. `singletonKey = requestId` + queue policy `exclusive`
 * → at most one queued-or-active job per request (ADR-0001 D4).
 */
export async function enqueueRequestProcessing(queue: JobSender, tx: TenantTx, requestId: string): Promise<string> {
  const job: RequestJob = { requestId, companyId: tenantOf(tx) };
  return sendInTransaction(queue, tx, QUEUES.processRequest, job, { singletonKey: requestId });
}
