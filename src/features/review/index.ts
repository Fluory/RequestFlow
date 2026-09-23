// Public API of the `review` module: review view, corrections, approve/reject, source view.
export {
  approveRequest,
  confirmNotDuplicate,
  rejectAsDuplicate,
  correctField,
  correctionHistory,
  currentFieldValues,
  FIELD_LABELS,
  loadReview,
  REJECTION_REASON_MAX,
  rejectRequest,
  ReviewRefused,
  type FieldStatus,
  type ReviewRefusal,
  type ReviewStatus,
  type ReviewField,
  type ReviewView,
} from "./review";
export { buildSourceView, type SourceLine, type SourceView } from "./source-view";
