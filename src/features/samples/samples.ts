import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AiServiceClient, ExtractResponse } from "@/features/extraction";

// Prepared showcase cases (#71): synthetic mails whose AI answer was recorded once
// (`pnpm samples:record`) and is replayed when a sample is seeded – no live model call.
export interface Sample {
  key: string;
  filename: string;
  /** `review`: stays in review for visitors to try; `exported`: approved and exported through the normal path. */
  purpose: "review" | "exported";
}

export const SAMPLES: readonly Sample[] = [
  { key: "werk-ost", filename: "werk-ost.eml", purpose: "review" },
  { key: "pumpe-p204", filename: "pumpe-p204.eml", purpose: "exported" },
];

const dataFile = (name: string) => new URL(`./data/${name}`, import.meta.url);

export const recordingFile = (sample: Sample) => dataFile(`${sample.key}.recording.json`);

/** The committed mail. */
export function sampleMail(sample: Sample): Uint8Array {
  return new Uint8Array(readFileSync(dataFile(sample.filename)));
}

/**
 * The mail as a new arrival: a fresh Message-ID, so a sample seeded again is not flagged as a duplicate of
 * an earlier one. The header is not a segment of the recording, so the recorded evidence still matches.
 */
export function freshSampleMail(sample: Sample, messageId: string = `<sample-${randomUUID()}@example.com>`): Uint8Array {
  const text = new TextDecoder().decode(sampleMail(sample));
  const replaced = text.replace(/^Message-ID: .*$/m, `Message-ID: ${messageId}`);
  if (replaced === text) throw new Error(`sample ${sample.key} has no Message-ID header`);
  return new TextEncoder().encode(replaced);
}

export function sampleRecording(sample: Sample): ExtractResponse {
  return JSON.parse(readFileSync(recordingFile(sample), "utf8")) as ExtractResponse;
}

/** Marks a replayed run in its stored model id, so a recorded answer is never mistaken for a live one. */
export const RECORDED_MODEL_PREFIX = "recorded:";

/** An AI client that answers with the recording – for the document it is given, without any network call. */
export function recordedAiClient(recording: ExtractResponse): AiServiceClient {
  return {
    async extract(input) {
      return {
        ...recording,
        documentId: input.documentId,
        run: { ...recording.run, modelId: `${RECORDED_MODEL_PREFIX}${recording.run.modelId}` },
      };
    },
  };
}
