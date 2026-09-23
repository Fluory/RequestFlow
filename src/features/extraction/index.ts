// Public API of the `extraction` module: AI-service client (contract types generated from
// contracts/ai-service.openapi.yaml), field merge, persistence of runs, segments and fields.
export type { components as AiServiceComponents, paths as AiServicePaths } from "./ai-service.contract";
export type { ExtractResponse, FieldResult } from "./types";
export { AiServiceError, createAiServiceClient, type AiServiceClient, type AiServiceSettings, type ExtractInput } from "./ai-client";
export { HEADER_FIELDS, mergeFields, type HeaderField, type MergedField } from "./merge";
export { latestRun, listSegments, persistExtractionRun, runExistsForJob, type DocumentOutcome } from "./repository";
