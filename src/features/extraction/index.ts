// Public API of the `extraction` module: AI-service contract types (client + persistence: #7).
export type { components as AiServiceComponents, paths as AiServicePaths } from "./ai-service.contract";
export type ExtractResponse = import("./ai-service.contract").components["schemas"]["ExtractResponse"];
export type FieldResult = import("./ai-service.contract").components["schemas"]["FieldResult"];
