// Shared job wiring (module `jobs`, ADR-0001 D2): builds the processing and export dependencies from the
// configuration and runs one bounded drain round. Used by the long-running worker (src/worker.ts) and by
// the serverless drain (src/app/_server/drain.ts: route `/api/jobs/drain` and `after()`), so both run
// the same handlers against the same queues. Composition only – no connections are opened here.
import type { AppConfig } from "@/config/env";
import type { Database } from "@/db";
import { createErpClient, drainExports, type ExportDrainDeps, type ExportDrainResult } from "@/features/export";
import { createAiServiceClient } from "@/features/extraction";
import { purgeGuestCompany } from "@/features/identity";
import { drain, drainGuestPurges, enqueueExpiredGuestPurges, QUEUES, type DrainDeps, type DrainResult, type GuestPurgeRunner, type GuestSweepDeps, type JobRunner } from "@/features/jobs";
import { currentFieldValues, currentLineItemValues } from "@/features/review";
import type { S3BlobStore } from "@/features/storage";
import type { Tenancy } from "@/features/tenancy";

export interface JobDeps {
  processing: DrainDeps;
  exports: ExportDrainDeps;
  /** Guest retention (ADR-0001 D7 amendment 2026-11-20) – wired whenever a database handle is given. */
  guests?: { sweep: GuestSweepDeps; runner: GuestPurgeRunner; retentionMs: number };
}

/** Guest purge jobs per round: each is a few storage deletes and one transaction. */
const GUEST_PURGES_PER_ROUND = 5;

export interface DrainRoundOptions {
  /** Stop starting processing jobs after this many ms (the job in hand always finishes). */
  processMs: number;
  /** Stop starting export jobs after this many ms. */
  exportMs: number;
  /** Run pg-boss maintenance (expiry → retry, dead letter, retention) first – runtimes without a supervising worker. */
  maintenance?: boolean;
  /** Queue names – tests use dedicated queues. */
  queues?: { process: { process: string; dead: string }; export: { export: string; dead: string } };
}

export interface DrainRoundResult {
  processing: DrainResult;
  exports: ExportDrainResult;
  /** Only when the round ran the guest retention. */
  guests?: { queued: number; purged: number; failed: number };
}

/** Fail-closed: a missing AI_SERVICE_TOKEN or ERP_TOKEN throws (the error names the variable only). */
export function buildJobDeps(
  config: AppConfig,
  parts: { tenancy: Tenancy; storage: Pick<S3BlobStore, "get" | "delete">; boss: JobRunner & GuestSweepDeps["boss"]; db?: Database },
): JobDeps {
  const { tenancy, storage, boss, db } = parts;
  return {
    ...(db
      ? {
          guests: {
            sweep: { db, boss },
            runner: { boss, purge: (companyId: string) => purgeGuestCompany({ tenancy, storage }, companyId) },
            retentionMs: config.guests.retentionHours * 60 * 60 * 1000,
          },
        }
      : {}),
    processing: { tenancy, storage, boss, ai: createAiServiceClient(config.aiService) },
    // The export reads the reviewed values through the review module (injected – no module cycle).
    exports: { tenancy, boss, erp: createErpClient(config.erp), fieldValues: currentFieldValues, lineItemValues: currentLineItemValues },
  };
}

export async function drainRound(deps: JobDeps, options: DrainRoundOptions): Promise<DrainRoundResult> {
  const queues = options.queues ?? {
    process: { process: QUEUES.processRequest, dead: QUEUES.processRequestDead },
    export: { export: QUEUES.exportRequest, dead: QUEUES.exportRequestDead },
  };
  if (options.maintenance) {
    for (const name of [queues.process.process, queues.process.dead, queues.export.export, queues.export.dead]) await deps.processing.boss.supervise(name);
  }
  const processing = await drain(deps.processing, { maxMs: options.processMs, queues: queues.process });
  const exports = await drainExports(deps.exports, { maxMs: options.exportMs, queues: queues.export });
  if (!deps.guests) return { processing, exports };
  if (options.maintenance) await deps.processing.boss.supervise(QUEUES.purgeGuest);
  const queued = await enqueueExpiredGuestPurges(deps.guests.sweep, { retentionMs: deps.guests.retentionMs });
  const purges = await drainGuestPurges(deps.guests.runner, { maxJobs: GUEST_PURGES_PER_ROUND });
  return { processing, exports, guests: { queued, ...purges } };
}

export const handledJobs = ({ processing, exports, guests }: DrainRoundResult): number =>
  processing.processed + processing.failed + processing.deadLettered + exports.exported + exports.failed + exports.deadLettered + (guests ? guests.purged + guests.failed : 0);
