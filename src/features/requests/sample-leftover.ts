import type { RequestRow } from "./repository";

/**
 * A prepared sample (#71) that an aborted seed run left behind (#84). Processing of a sample is never
 * queued, so NEW, PROCESSING and ERROR from processing only mean the run broke off. Never a decided sample,
 * and never an approved one whose export failed (ERROR from export): it may already be in the ERP and can be
 * exported again (#92 review).
 */
export function isSampleLeftover(request: Pick<RequestRow, "source" | "status" | "errorStage">): boolean {
  if (request.source !== "sample") return false;
  if (request.status === "NEW" || request.status === "PROCESSING") return true;
  return request.status === "ERROR" && request.errorStage === "processing";
}
