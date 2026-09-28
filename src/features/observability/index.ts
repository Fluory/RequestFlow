// Public API of the `observability` module: health aggregation, structured log lines (IDs only).
export { cachedFor, runHealthChecks, withStartupGrace, type CheckResult, type DependencyResult, type HealthCheck, type HealthReport, type HealthResult } from "./health";
export { captureLogs, logEvent, type LogDetail, type LogIds, type LogLevel } from "./log";
