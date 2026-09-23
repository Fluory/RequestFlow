// Public API of the `jobs` module: queue definitions, transactional enqueue (worker + drain(): #7).
// The pg-boss client itself is created in src/db (it opens a pool) and injected.
export { enqueueRequestProcessing, type JobSender } from "./boss";
export { QUEUE_DEFINITIONS, QUEUES, type QueueName, type RequestJob } from "./queues";
