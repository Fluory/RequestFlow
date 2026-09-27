import { randomUUID } from "node:crypto";
import type { Actor } from "@/features/identity";
import { submitUpload, type IntakeDeps } from "@/features/intake";
import { processRequestJob, type JobSender } from "@/features/jobs";
import { countSamples, markSample, type RequestRow } from "@/features/requests";
import { approveRequest } from "@/features/review";
import { freshSampleMail, recordedAiClient, SAMPLES, sampleRecording, type Sample } from "./samples";

// While a sample of a purpose is in one of these statuses it still serves that purpose – no new one.
const STILL_SERVING: Record<Sample["purpose"], readonly RequestRow["status"][]> = {
  review: ["NEW", "PROCESSING", "REVIEW"],
  exported: ["APPROVED", "EXPORTED"],
};

export interface SeededSample {
  key: string;
  requestId: string;
  status: "REVIEW" | "APPROVED";
}

/**
 * Seeds the prepared samples of the actor's company (#71), idempotently: a sample is created only when no
 * sample of its purpose still serves. Every step runs the real path – intake (original stored, request,
 * documents, audit, duplicate check), processing (run, segments, fields, REVIEW) and, for the exported
 * sample, the approval that queues the export. One deliberate difference: processing runs inline with the
 * recorded answer instead of through the queue, so no drain can ever send a sample to the live model.
 */
export async function seedSamples(deps: IntakeDeps, actor: Actor): Promise<SeededSample[]> {
  const seeded: SeededSample[] = [];
  for (const sample of SAMPLES) {
    const serving = await deps.tenancy.withTenant(actor.companyId, (tx) => countSamples(tx, STILL_SERVING[sample.purpose]));
    if (serving > 0) continue;
    const requestId = await createSample(deps, actor, sample);
    if (sample.purpose === "exported") await approveRequest({ tenancy: deps.tenancy, boss: deps.boss }, actor, requestId);
    seeded.push({ key: sample.key, requestId, status: sample.purpose === "exported" ? "APPROVED" : "REVIEW" });
  }
  return seeded;
}

async function createSample(deps: IntakeDeps, actor: Actor, sample: Sample): Promise<string> {
  // Takes the processing job the intake would queue and hands out its id for the inline run instead.
  let jobId: string | undefined;
  const inline = { send: async () => (jobId = randomUUID()) } as unknown as JobSender;
  const { requestId } = await submitUpload({ ...deps, boss: inline }, actor, [{ name: sample.filename, bytes: freshSampleMail(sample) }]);
  if (!jobId) throw new Error(`sample ${sample.key}: the intake queued no processing job`);
  await deps.tenancy.withTenant(actor.companyId, (tx) => markSample(tx, requestId));
  const outcome = await processRequestJob(
    { tenancy: deps.tenancy, storage: deps.storage, ai: recordedAiClient(sampleRecording(sample)) },
    { id: jobId, data: { requestId, companyId: actor.companyId } },
  );
  if (outcome !== "processed") throw new Error(`sample ${sample.key} was not processed`);
  return requestId;
}
