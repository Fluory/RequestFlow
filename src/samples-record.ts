// Records the AI service's answer for every file of every sample (`pnpm samples:record`, #71, #74). Run once
// against a deployed AI service; the answers are committed next to the files and replayed by
// `pnpm seed:samples`. Synthetic files only. Needs AI_SERVICE_URL and AI_SERVICE_TOKEN (never printed).
// Optional arguments: sample keys.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { AiServiceError, createAiServiceClient } from "@/features/extraction";
import { recordingDocumentId, recordingFile, SAMPLES, sampleFile } from "@/features/samples";

const ATTEMPTS = 8;
const WAIT_MS = 30_000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const client = createAiServiceClient({ baseUrl: required("AI_SERVICE_URL"), token: required("AI_SERVICE_TOKEN"), timeoutMs: 120_000 });
  // `pnpm samples:record <key> …` records only these samples and keeps the other recordings.
  const only = process.argv.slice(2);
  const files = SAMPLES.filter(({ key }) => only.length === 0 || only.includes(key)).flatMap((sample) => sample.files);
  for (const file of files) {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await client.extract({
          bytes: sampleFile(file),
          filename: file.filename,
          mediaType: file.mediaType,
          documentId: recordingDocumentId(file),
          correlationId: randomUUID(),
        });
        writeFileSync(recordingFile(file), `${JSON.stringify(response, null, 2)}\n`);
        const statuses = Object.entries(response.fields).map(([key, field]) => `${key}=${field.status}`).join(" ");
        console.log(`recorded ${file.filename}: ${statuses}; ${response.lineItems.length} line items; model ${response.run.modelId}`);
        break;
      } catch (error) {
        // Overload of the model provider is common on the free tier: wait and try again.
        if (!(error instanceof AiServiceError) || !error.retryable || attempt >= ATTEMPTS) throw error;
        console.log(`${file.filename}: ${error.code}, attempt ${attempt} of ${ATTEMPTS} – retrying`);
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "recording failed");
  process.exit(1);
});
