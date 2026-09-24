"""JSON logging with IDs only (never document content, tokens or free-form messages with data).

Each record carries a constant event name (the log message template, never formatted with its
arguments), the request and document IDs from context variables, and only allow-listed extras.
Exceptions are reduced to their type name: tracebacks and messages can contain document data.
The line shape matches the web/worker pino logs (`level`, `time`, `event`, `requestId`, ...), see
docs/technical/operations.md "Logs and correlation". The service never learns `jobId` or `companyId`
(it only gets `X-Request-Id`), so those keys appear in web/worker lines only.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
document_id_var: ContextVar[str | None] = ContextVar("document_id", default=None)

_ALLOWED_EXTRAS = (
    "method",
    "path",
    "status",
    "latencyMs",
    "modelLatencyMs",
    "errorCode",
    "documentKind",
    "segmentCount",
    "modelId",
    "promptVersion",
    "inputTokens",
    "outputTokens",
    "fieldStatus",
    "lineItemCount",
    "attachmentCount",
    "attachmentFailedCount",
    "ocrSegmentCount",
    "depth",
    "errorType",
    "header",
    "note",
)
# Third-party loggers that may log file names, URLs or payload snippets at INFO/DEBUG.
_QUIET_LOGGERS = (
    "docling",
    "docling_core",
    "docling_parse",
    "google_genai",
    "httpx",
    "httpcore",
    "RapidOCR",  # rapidocr's own logger (model paths, download URLs)
)


# Same labels as pino in the web/worker logs (src/features/observability/log.ts).
_LEVEL_LABELS = {
    "DEBUG": "debug",
    "INFO": "info",
    "WARNING": "warn",
    "ERROR": "error",
    "CRITICAL": "fatal",
}


class JsonFormatter(logging.Formatter):
    """One line per record with the web/worker key set: `level`, `time`, `event` plus IDs."""

    def format(self, record: logging.LogRecord) -> str:
        created = datetime.fromtimestamp(record.created, UTC)
        payload: dict[str, Any] = {
            "level": _LEVEL_LABELS.get(record.levelname, record.levelname.lower()),
            # pino's isoTime (`Date.toISOString()`): UTC, milliseconds, `Z` suffix.
            "time": created.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "event": record.msg if isinstance(record.msg, str) else type(record.msg).__name__,
        }
        request_id = request_id_var.get()
        if request_id:
            payload["requestId"] = request_id
        document_id = document_id_var.get()
        if document_id:
            payload["documentId"] = document_id
        for key in _ALLOWED_EXTRAS:
            if key in record.__dict__:
                payload[key] = record.__dict__[key]
        # A library's own record (docling, httpx, uvicorn) names its source; our records do not
        # need it, like the pino lines (#51 review).
        if not record.name.startswith("requestflow_ai"):
            payload["logger"] = record.name
        if record.exc_info and record.exc_info[0] is not None:
            payload["excType"] = record.exc_info[0].__name__
        # Compact separators like pino, so a line is byte-for-byte the same shape as web/worker.
        return json.dumps(payload, ensure_ascii=False, default=str, separators=(",", ":"))


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True
    # Access lines are written by our middleware (with the request ID); uvicorn's would duplicate.
    logging.getLogger("uvicorn.access").disabled = True
    for name in _QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
