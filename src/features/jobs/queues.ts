import type { Queue } from "pg-boss";

// Queue definitions (ADR-0001 D4). Installed by the deploy step as the owner role; the runtime role
// only sends, fetches and completes jobs. Payloads carry IDs only – never document content.
export const PGBOSS_SCHEMA = "pgboss";

export const QUEUES = {
  processRequest: "request-process",
  processRequestDead: "request-process-dead",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface RequestJob {
  requestId: string;
  companyId: string;
}

// `exclusive` + singletonKey = requestId: at most one queued-or-active job per request.
export const QUEUE_DEFINITIONS: Array<Queue> = [
  { name: QUEUES.processRequestDead, policy: "standard", retentionSeconds: 60 * 60 * 24 * 14 },
  {
    name: QUEUES.processRequest,
    policy: "exclusive",
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 60 * 30,
    expireInSeconds: 60 * 10,
    deadLetter: QUEUES.processRequestDead,
  },
];
