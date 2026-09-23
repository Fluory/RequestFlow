// Public API of the `observability` module: health aggregation, structured log lines (IDs only).
export { runHealthChecks, type HealthCheck, type HealthReport, type HealthResult } from "./health";
export { logEvent, type LogDetail, type LogIds, type LogLevel } from "./log";
