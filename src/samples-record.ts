// Records the AI service's answer for every sample mail (`pnpm samples:record`, #71). Run once against a
// deployed AI service; the answers are committed next to the mails and replayed by `pnpm seed:samples`.
// Synthetic mails only. Needs AI_SERVICE_URL and AI_SERVICE_TOKEN (never printed). Optional arguments: sample keys.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { AiServiceError, createAiServiceClient } from "@/features/extraction";
import { recordingFile, SAMPLES, sampleMail } from "@/features/samples";

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
  for (const sample of SAMPLES.filter(({ key }) => only.length === 0 || only.includes(key))) {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await client.extract({
          bytes: sampleMail(sample),
          filename: sample.filename,
          mediaType: "message/rfc822",
          documentId: `sample-${sample.key}`,
          correlationId: randomUUID(),
        });
        writeFileSync(recordingFile(sample), `${JSON.stringify(response, null, 2)}\n`);
        const statuses = Object.entries(response.fields).map(([key, field]) => `${key}=${field.status}`).join(" ");
        console.log(`recorded ${sample.key}: ${statuses}; ${response.lineItems.length} line items; model ${response.run.modelId}`);
        break;
      } catch (error) {
        // Overload of the model provider is common on the free tier: wait and try again.
        if (!(error instanceof AiServiceError) || !error.retryable || attempt >= ATTEMPTS) throw error;
        console.log(`${sample.key}: ${error.code}, attempt ${attempt} of ${ATTEMPTS} – retrying`);
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "recording failed");
  process.exit(1);
});
