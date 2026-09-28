import type { RequestSource, RequestStatus } from "@/db/schema";

// Its own input type from the schema – importing RequestRow from the repository would close a cycle.
export interface SampleLeftoverCandidate {
  source: RequestSource;
  status: RequestStatus;
  errorStage: "processing" | "export" | null;
}

/**
 * A prepared sample (#71) that an aborted seed run left behind (#84). Processing of a sample is never
 * queued, so NEW, PROCESSING and ERROR from processing only mean the run broke off. Never a decided sample,
 * and never an approved one whose export failed (ERROR from export): it may already be in the ERP and can be
 * exported again (#92 review).
 */
export function isSampleLeftover(request: SampleLeftoverCandidate): boolean {
  if (request.source !== "sample") return false;
  if (request.status === "NEW" || request.status === "PROCESSING") return true;
  return request.status === "ERROR" && request.errorStage === "processing";
}
