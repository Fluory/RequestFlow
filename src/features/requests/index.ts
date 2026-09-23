// Public API of the `requests` module: request aggregate and status machine.
export {
  createRequest,
  findDuplicate,
  getRequest,
  listRequests,
  type RequestFilter,
  lockDuplicateDetection,
  lockRequest,
  recordProcessingFailure,
  transitionRequest,
  type NewRequest,
  type RequestRow,
} from "./repository";
export { canTransition, InvalidTransition, nextStatus, type ErrorStage, type RequestEvent } from "./status";
