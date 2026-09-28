import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseExtractResponse, type AiServiceClient, type ExtractResponse } from "@/features/extraction";

// Prepared showcase cases (#71): synthetic requests whose AI answer was recorded once per file
// (`pnpm samples:record`) and is replayed when a sample is seeded – no live model call.
export interface SampleFile {
  filename: string;
  mediaType: string;
}

export interface Sample {
  key: string;
  /** Uploaded together as one request, in this order; exactly one mail (it gets a fresh Message-ID). */
  files: readonly SampleFile[];
  /** `review`: stays in review for visitors to try; `exported`: approved and exported through the normal path. */
  purpose: "review" | "exported";
}

const MAIL = "message/rfc822";

export const SAMPLES: readonly Sample[] = [
  // #74: the positions and the delivery week come from a PDF, so a visitor sees the original page.
  {
    key: "werk-ost",
    files: [
      { filename: "werk-ost.eml", mediaType: MAIL },
      { filename: "werk-ost-positionen.pdf", mediaType: "application/pdf" },
    ],
    purpose: "review",
  },
  { key: "pumpe-p204", files: [{ filename: "pumpe-p204.eml", mediaType: MAIL }], purpose: "exported" },
];

const dataFile = (name: string) => new URL(`./data/${name}`, import.meta.url);

const stem = (file: SampleFile) => file.filename.replace(/\.[^.]+$/, "");

/** `werk-ost-positionen.pdf` → `werk-ost-positionen.recording.json`. */
export const recordingFile = (file: SampleFile) => dataFile(`${stem(file)}.recording.json`);

/** The document id a recording was made with – checked when it is read. */
export const recordingDocumentId = (file: SampleFile) => `sample-${stem(file)}`;

/** The committed file. */
export function sampleFile(file: SampleFile): Uint8Array {
  return new Uint8Array(readFileSync(dataFile(file.filename)));
}

/**
 * The files as a new arrival: the mail gets a fresh Message-ID, so a sample seeded again is not flagged as
 * a duplicate of an earlier one (neither by Message-ID nor by the set of file hashes). The header is not a
 * segment of the recording, so the recorded evidence still matches; other files stay byte for byte.
 */
export function freshSampleFiles(sample: Sample, messageId: string = `<sample-${randomUUID()}@example.com>`): Array<{ name: string; bytes: Uint8Array }> {
  return sample.files.map((file) => {
    const bytes = sampleFile(file);
    if (file.mediaType !== MAIL) return { name: file.filename, bytes };
    const text = new TextDecoder().decode(bytes);
    const replaced = text.replace(/^Message-ID: .*$/m, `Message-ID: ${messageId}`);
    if (replaced === text) throw new Error(`sample ${sample.key} has no Message-ID header`);
    return { name: file.filename, bytes: new TextEncoder().encode(replaced) };
  });
}

/** The committed recording of one file, validated like a live answer (#83 review): a damaged file fails here, not later. */
export function sampleRecording(file: SampleFile): ExtractResponse {
  const recording = parseExtractResponse(JSON.parse(readFileSync(recordingFile(file), "utf8")), recordingDocumentId(file));
  if (!recording) throw new Error(`recording of sample file ${file.filename} does not match the AI service contract`);
  return recording;
}

/** The recordings of a sample by file name. */
export function sampleRecordings(sample: Sample): Map<string, ExtractResponse> {
  return new Map(sample.files.map((file) => [file.filename, sampleRecording(file)]));
}

/** Marks a replayed run in its stored model id, so a recorded answer is never mistaken for a live one. */
export const RECORDED_MODEL_PREFIX = "recorded:";

/**
 * An AI client that answers with the recording of the file it is given, without any network call. The
 * replayed run is marked as recorded and consumed no tokens and no model time (#83 review).
 */
export function recordedAiClient(recordings: ReadonlyMap<string, ExtractResponse>): AiServiceClient {
  return {
    async extract(input) {
      const recording = recordings.get(input.filename);
      if (!recording) throw new Error(`no recording for ${input.filename}`);
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
