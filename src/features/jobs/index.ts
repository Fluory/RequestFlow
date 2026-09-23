// Public API of the `jobs` module: queue definitions, transactional enqueue, the processing handler,
// drain() and reprocess. The pg-boss client itself is created in src/db and injected.
export { enqueueRequestProcessing, type JobSender } from "./boss";
export { drain, type DrainDeps, type DrainOptions, type DrainResult, type JobRunner } from "./drain";
export { describeFailure, PermanentProcessingError, processRequestJob, type ProcessingDeps } from "./process-request";
export { QUEUE_DEFINITIONS, QUEUES, type QueueName, type RequestJob } from "./queues";
export { reprocessRequest, ReprocessRefused } from "./reprocess";
export { assertProcessingBudget, PROCESS_EXPIRE_SECONDS } from "./budget";
