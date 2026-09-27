import { randomUUID } from "node:crypto";
import { exportRequestJob, type ExportDeps } from "@/features/export";
import type { Actor } from "@/features/identity";
import { submitUpload, type IntakeDeps } from "@/features/intake";
import { enqueueRequestExport, markProcessingFailed, processRequestJob, type JobSender } from "@/features/jobs";
import { logEvent } from "@/features/observability";
import { countSamples, type RequestRow } from "@/features/requests";
import { approveRequest } from "@/features/review";
import { freshSampleMail, recordedAiClient, SAMPLES, sampleRecording, type Sample } from "./samples";

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

export interface SeededSample {
  key: string;
  requestId: string;
  /** APPROVED: the ERP was not reachable, the export job is queued and retried like any other. */
  status: "REVIEW" | "EXPORTED" | "APPROVED";
}

/** A sender that queues nothing and hands out the id of the job it was asked to queue. */
function inlineSender(): { sender: JobSender; jobId: () => string } {
  let id: string | undefined;
  const sender = { send: async () => (id = randomUUID()) } as unknown as JobSender;
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
 * sample, approval and export (ERP call with idempotency key, export row, audit). One deliberate
 * difference: the jobs run inline instead of through the queue – processing with the recorded answer, so
 * no drain can ever send a sample to the live model, and the export right away, so visitors see the ERP
 * reference without doing anything.
 */
export async function seedSamples(deps: SampleDeps, actor: Actor): Promise<SeededSample[]> {
  const seeded: SeededSample[] = [];
  for (const sample of SAMPLES) {
    const serving = await deps.tenancy.withTenant(actor.companyId, (tx) => countSamples(tx, STILL_SERVING[sample.purpose]));
    if (serving > 0) continue;
    const requestId = await createSample(deps, actor, sample);
    const status = sample.purpose === "exported" ? await approveAndExport(deps, actor, requestId) : "REVIEW";
    seeded.push({ key: sample.key, requestId, status });
  }
  return seeded;
}

async function createSample(deps: SampleDeps, actor: Actor, sample: Sample): Promise<string> {
  const processing = inlineSender();
  const { requestId } = await submitUpload({ ...deps, boss: processing.sender }, actor, [{ name: sample.filename, bytes: freshSampleMail(sample) }], {
    source: "sample",
  });
  const job = { id: processing.jobId(), data: { requestId, companyId: actor.companyId } };
  try {
    const outcome = await processRequestJob({ tenancy: deps.tenancy, storage: deps.storage, ai: recordedAiClient(sampleRecording(sample)) }, job);
    if (outcome !== "processed") throw new Error(`sample ${sample.key} was not processed`);
  } catch (error) {
    // Visible and settled instead of "in progress" forever; reprocessing a sample is refused (no live call).
    await markProcessingFailed(deps.tenancy, job.data, "Das Beispiel konnte nicht vorbereitet werden – bitte das Anlegen der Beispiele wiederholen.", job.id);
    throw error;
  }
  return requestId;
}

async function approveAndExport(deps: SampleDeps, actor: Actor, requestId: string): Promise<"EXPORTED" | "APPROVED"> {
  const exporting = inlineSender();
  await approveRequest({ tenancy: deps.tenancy, boss: exporting.sender }, actor, requestId);
  const job = { id: exporting.jobId(), data: { requestId, companyId: actor.companyId } };
  try {
    await exportRequestJob(deps.export, job);
    return "EXPORTED";
  } catch (error) {
    // The ERP is not reachable right now: hand the export to the queue, which retries it like any other.
    await deps.tenancy.withTenant(actor.companyId, (tx) => enqueueRequestExport(deps.boss, tx, requestId));
    logEvent("warn", "sample.export_queued", { requestId, companyId: actor.companyId }, { code: error instanceof Error ? error.name : "unknown" });
    return "APPROVED";
  }
}
