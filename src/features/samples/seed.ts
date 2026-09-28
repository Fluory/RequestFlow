import { randomUUID } from "node:crypto";
import { recordAudit } from "@/features/audit";
import { exportRequestJob, type ExportDeps } from "@/features/export";
import type { Actor } from "@/features/identity";
import { submitUpload, type IntakeDeps } from "@/features/intake";
import { markProcessingFailed, processRequestJob, type JobSender } from "@/features/jobs";
import { countSamples, listSampleLeftoverIds, lockRequest, retireSampleLeftover, type RequestRow } from "@/features/requests";
import { approveRequest } from "@/features/review";
import { freshSampleFiles, recordedAiClient, SAMPLES, sampleRecordings, type Sample } from "./samples";

// While a sample of a purpose is in one of these statuses it still serves that purpose – no new one.
// Only settled states count (#83 review): a sample left in NEW/PROCESSING/ERROR by an aborted run must
// not block the next run.
const STILL_SERVING: Record<Sample["purpose"], readonly RequestRow["status"][]> = {
  review: ["REVIEW"],
  exported: ["APPROVED", "EXPORTED"],
};

export interface SampleDeps extends IntakeDeps {
  /** The normal export path (ERP adapter, reviewed values) – the exported sample runs through it. */
  export: ExportDeps;
}

const LEFTOVER_REASON = "Beispiel durch einen neuen Lauf ersetzt – das Anlegen war abgebrochen.";

export interface SeedResult {
  seeded: SeededSample[];
  /** Leftovers of aborted runs settled as rejected (#84). */
  retired: number;
}

export interface SeededSample {
  key: string;
  requestId: string;
  /** APPROVED: the ERP was not reachable; the export job queued with the approval retries it like any other. */
  status: "REVIEW" | "EXPORTED" | "APPROVED";
}

/**
 * A sender that remembers the id of the job it was asked to queue. `queue` present: the job is really
 * queued (in the caller's transaction) through it; absent: nothing is queued and the id is made up.
 */
function recordingSender(queue?: JobSender): { sender: JobSender; jobId: () => string } {
  let id: string | undefined;
  const sender = {
    send: async (...args: Parameters<JobSender["send"]>) => (id = queue ? ((await queue.send(...args)) ?? undefined) : randomUUID()),
  } as unknown as JobSender;
  return {
    sender,
    jobId: () => {
      if (!id) throw new Error("no job was queued");
      return id;
    },
  };
}

/**
 * Seeds the prepared samples of the actor's company (#71), idempotently: a sample is created only when no
 * sample of its purpose still serves. Every step runs the real path – intake (original stored, request,
 * documents, audit, duplicate check), processing (run, segments, fields, REVIEW) and, for the exported
 * sample, approval and export (ERP call with idempotency key, export row, audit). Two deliberate
 * differences: processing runs inline with the recorded answer and is never queued, so no drain can send
 * a sample to the live model; and the export job queued by the approval runs right away, so visitors see
 * the ERP reference without doing anything.
 */
export async function seedSamples(deps: SampleDeps, actor: Actor): Promise<SeedResult> {
  const retired = await retireLeftovers(deps, actor);
  const seeded: SeededSample[] = [];
  for (const sample of SAMPLES) {
    const serving = await deps.tenancy.withTenant(actor.companyId, (tx) => countSamples(tx, STILL_SERVING[sample.purpose]));
    if (serving > 0) continue;
    const requestId = await createSample(deps, actor, sample);
    const status = sample.purpose === "exported" ? await approveAndExport(deps, actor, requestId) : "REVIEW";
    seeded.push({ key: sample.key, requestId, status });
  }
  return { seeded, retired };
}

/**
 * Settles samples an aborted run left behind (#84): through the status machine, with the reason visible
 * on the request and an audit event – never deleted. Which samples count is decided in the requests
 * module (`isSampleLeftover`, re-checked under the row lock).
 */
async function retireLeftovers(deps: SampleDeps, actor: Actor): Promise<number> {
  return deps.tenancy.withTenant(actor.companyId, async (tx) => {
    let retired = 0;
    for (const id of await listSampleLeftoverIds(tx)) {
      const request = await lockRequest(tx, id);
      if (!request) continue;
      const settled = await retireSampleLeftover(tx, request, LEFTOVER_REASON);
      if (!settled) continue;
      await recordAudit(tx, { actorUserId: actor.userId, action: "request.sample_retired", entityType: "request", entityId: id, data: { from: request.status } });
      retired++;
    }
    return retired;
  });
}

async function createSample(deps: SampleDeps, actor: Actor, sample: Sample): Promise<string> {
  // Processing is never queued: a queued job could reach the live model.
  const processing = recordingSender();
  const { requestId } = await submitUpload({ ...deps, boss: processing.sender }, actor, freshSampleFiles(sample), {
    source: "sample",
  });
  const job = { id: processing.jobId(), data: { requestId, companyId: actor.companyId } };
  try {
    const outcome = await processRequestJob({ tenancy: deps.tenancy, storage: deps.storage, ai: recordedAiClient(sampleRecordings(sample)) }, job);
    if (outcome !== "processed") throw new Error(`sample ${sample.key} was not processed`);
  } catch (error) {
    // Visible and settled instead of "in progress" forever; reprocessing a sample is refused (no live call).
    await markProcessingFailed(deps.tenancy, job.data, "Das Beispiel konnte nicht vorbereitet werden – bitte das Anlegen der Beispiele wiederholen.", job.id);
    throw error;
  }
  return requestId;
}

/**
 * The approval queues the export job in its own transaction, as always (ADR-0001 D9) – so an aborted
 * seed can never leave an approved sample without one (#83 re-review). The seed then runs that very job
 * right away; when the queue delivers it later it finds EXPORTED and skips. An unreachable ERP simply
 * leaves the job to the queue's retries.
 */
async function approveAndExport(deps: SampleDeps, actor: Actor, requestId: string): Promise<"EXPORTED" | "APPROVED"> {
  const exporting = recordingSender(deps.boss);
  await approveRequest({ tenancy: deps.tenancy, boss: exporting.sender }, actor, requestId);
  try {
    await exportRequestJob(deps.export, { id: exporting.jobId(), data: { requestId, companyId: actor.companyId } });
    return "EXPORTED";
  } catch {
    return "APPROVED";
  }
}
