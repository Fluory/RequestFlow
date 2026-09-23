"""JSON logging with IDs only (never document content, tokens or free-form messages with data).

Each record carries a constant event name (the log message template, never formatted with its
arguments), the request and document IDs from context variables, and only allow-listed extras.
Exceptions are reduced to their type name: tracebacks and messages can contain document data.
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
    "header",
    "note",
)
# Third-party loggers that may log file names, URLs or payload snippets at INFO/DEBUG.
_QUIET_LOGGERS = ("docling", "docling_core", "docling_parse", "google_genai", "httpx", "httpcore")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
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
        if record.exc_info and record.exc_info[0] is not None:
            payload["excType"] = record.exc_info[0].__name__
        return json.dumps(payload, ensure_ascii=False, default=str)


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
