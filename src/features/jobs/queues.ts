import type { Queue } from "pg-boss";
import { PROCESS_EXPIRE_SECONDS } from "./budget";

// Queue definitions (ADR-0001 D4). Installed by the deploy step as the owner role; the runtime role
// only sends, fetches and completes jobs. Payloads carry IDs only – never document content.
export const QUEUES = {
  processRequest: "request-process",
  processRequestDead: "request-process-dead",
  exportRequest: "request-export",
  exportRequestDead: "request-export-dead",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface RequestJob {
  requestId: string;
  companyId: string;
}

// `exclusive` + singletonKey = requestId: at most one queued-or-active job per request.
export const QUEUE_DEFINITIONS: Array<Queue> = [
  // The dead-letter handler only marks ERROR; if even that fails (database down), it retries.
  { name: QUEUES.processRequestDead, policy: "standard", retentionSeconds: 60 * 60 * 24 * 14, retryLimit: 10, retryDelay: 60, retryBackoff: true },
  {
    name: QUEUES.processRequest,
    policy: "exclusive",
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 60 * 30,
    expireInSeconds: PROCESS_EXPIRE_SECONDS,
    deadLetter: QUEUES.processRequestDead,
  },
  // Export of approved requests (#9 adds the handler). Enqueued in the approval transaction (#8).
  { name: QUEUES.exportRequestDead, policy: "standard", retentionSeconds: 60 * 60 * 24 * 14, retryLimit: 10, retryDelay: 60, retryBackoff: true },
  {
    name: QUEUES.exportRequest,
    policy: "exclusive",
    retryLimit: 8,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 60 * 30,
    expireInSeconds: 60 * 15,
    deadLetter: QUEUES.exportRequestDead,
  },
];
