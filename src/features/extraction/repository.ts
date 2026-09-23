import { and, desc, eq } from "drizzle-orm";
import { extractedFields, extractionRuns, extractionSegments } from "@/db/schema";
import { tenantOf, type TenantTx } from "@/features/tenancy";
import type { ExtractResponse } from "./types";
import { mergeFields } from "./merge";

export interface DocumentOutcome {
  documentId: string;
  /** Present when the AI service processed the document. */
  response?: ExtractResponse;
  /** Why a document was not processed (unsupported type, rejected by the service) – no content. */
  skipped?: string;
}

export async function runExistsForJob(tx: TenantTx, jobId: string): Promise<boolean> {
  tenantOf(tx);
  const [row] = await tx.select({ id: extractionRuns.id }).from(extractionRuns).where(eq(extractionRuns.jobId, jobId));
  return row !== undefined;
}

/**
 * Persists one extraction run: run metadata, the segments of every processed document and one
 * merged value per header field. Idempotent per job id (unique constraint as the last line).
 */
export async function persistExtractionRun(
  tx: TenantTx,
  input: { requestId: string; jobId: string; outcomes: DocumentOutcome[] },
): Promise<string | null> {
  const companyId = tenantOf(tx);
  const processed = input.outcomes.filter((outcome): outcome is DocumentOutcome & { response: ExtractResponse } => outcome.response !== undefined);
  const first = processed[0]?.response.run;
  const [run] = await tx
    .insert(extractionRuns)
    .values({
      companyId,
      requestId: input.requestId,
      jobId: input.jobId,
      modelId: first?.modelId ?? null,
      promptVersion: first?.promptVersion ?? null,
      schemaVersion: first?.schemaVersion ?? null,
      totalTokens: processed.reduce((sum, { response }) => sum + (response.run.tokens?.totalTokens ?? 0), 0),
      latencyMs: processed.reduce((sum, { response }) => sum + Math.round(response.run.latencyMs), 0),
      documents: input.outcomes.map(({ documentId, response, skipped }) =>
        response
          ? { documentId, kind: response.documentKind, modelId: response.run.modelId, promptVersion: response.run.promptVersion, schemaVersion: response.run.schemaVersion, tokens: response.run.tokens, latencyMs: response.run.latencyMs, warnings: response.warnings, segments: response.segments.length }
          : { documentId, skipped },
      ),
    })
    .onConflictDoNothing({ target: extractionRuns.jobId })
    .returning({ id: extractionRuns.id });
  if (!run) return null;

  const segments = processed.flatMap(({ documentId, response }) =>
    response.segments.map((segment, position) => ({ companyId, runId: run.id, documentId, segmentId: segment.id, position, text: segment.text, locator: segment.locator as Record<string, unknown> })),
  );
  for (let index = 0; index < segments.length; index += 500) await tx.insert(extractionSegments).values(segments.slice(index, index + 500));

  const merged = mergeFields(processed.map(({ documentId, response }) => ({ documentId, response })));
  await tx.insert(extractedFields).values(
    Object.entries(merged).map(([fieldKey, field]) => ({
      companyId,
      runId: run.id,
      requestId: input.requestId,
      fieldKey,
      value: field.value,
      status: field.status,
      modelStatus: field.modelStatus,
      reason: field.reason,
      documentId: field.documentId,
      segmentId: field.evidence?.segmentId ?? null,
      quote: field.evidence?.quote ?? null,
    })),
  );
  return run.id;
}

export async function latestRun(tx: TenantTx, requestId: string) {
  tenantOf(tx);
  const [run] = await tx
    .select()
    .from(extractionRuns)
    .where(eq(extractionRuns.requestId, requestId))
    .orderBy(desc(extractionRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const fields = await tx.select().from(extractedFields).where(and(eq(extractedFields.runId, run.id)));
  return { run, fields };
}
