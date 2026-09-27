import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseExtractResponse, type AiServiceClient, type ExtractResponse } from "@/features/extraction";

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

/** The committed recording, validated like a live answer (#83 review): a damaged file fails here, not later. */
export function sampleRecording(sample: Sample): ExtractResponse {
  const recording = parseExtractResponse(JSON.parse(readFileSync(recordingFile(sample), "utf8")), `sample-${sample.key}`);
  if (!recording) throw new Error(`recording of sample ${sample.key} does not match the AI service contract`);
  return recording;
}

/** Marks a replayed run in its stored model id, so a recorded answer is never mistaken for a live one. */
export const RECORDED_MODEL_PREFIX = "recorded:";

/**
 * An AI client that answers with the recording – for the document it is given, without any network call.
 * The replayed run is marked as recorded and consumed no tokens and no model time (#83 review).
 */
export function recordedAiClient(recording: ExtractResponse): AiServiceClient {
  return {
    async extract(input) {
      return {
        ...recording,
        documentId: input.documentId,
        run: {
          ...recording.run,
          modelId: `${RECORDED_MODEL_PREFIX}${recording.run.modelId}`,
          latencyMs: 0,
          tokens: { inputTokens: null, outputTokens: null, totalTokens: null },
        },
      };
    },
  };
}
