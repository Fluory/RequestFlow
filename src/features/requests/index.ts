// Public API of the `requests` module: request aggregate and status machine.
export {
  countRequestsByStatus,
  countRequestsCreatedBy,
  countSamples,
  createRequest,
  findDuplicate,
  getRequest,
  listRequests,
  type RequestFilter,
  type RequestPage,
  lockDuplicateDetection,
  lockRequest,
  markSample,
  recordDuplicateDecision,
  recordExportRetry,
  recordProcessingFailure,
  transitionRequest,
  type NewRequest,
  type RequestRow,
} from "./repository";
export { parseCursor, REQUEST_PAGE_SIZE } from "./cursor";
export { canTransition, InvalidTransition, nextStatus, type ErrorStage, type RequestEvent } from "./status";
