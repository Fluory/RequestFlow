"""The AI service log line has the same shape as the web/worker pino lines (#51)."""

from __future__ import annotations

import io
import json
import logging
import re

from requestflow_ai.jsonlog import JsonFormatter, document_id_var, request_id_var

ISO_UTC_MILLIS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def capture(level: int, event: str, extra: dict[str, object]) -> dict[str, object]:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("requestflow_ai.test_jsonlog")
    logger.addHandler(handler)
    logger.propagate = False
    request_token = request_id_var.set("req-synthetic-51")
    document_token = document_id_var.set("doc-synthetic-51")
    try:
        logger.log(level, event, extra=extra)
    finally:
        request_id_var.reset(request_token)
        document_id_var.reset(document_token)
        logger.removeHandler(handler)
    lines = stream.getvalue().splitlines()
    assert len(lines) == 1
    return json.loads(lines[0])


def test_log_line_uses_the_shared_key_set_of_the_ts_logs() -> None:
    record = capture(
        logging.WARNING,
        "extraction_failed",
        {"errorCode": "parse_failed", "quote": "Musterbau GmbH, max@example.com"},
    )

    assert set(record) == {"time", "level", "event", "requestId", "documentId", "errorCode"}
    assert record["level"] == "warn"
    assert isinstance(record["time"], str)
    assert ISO_UTC_MILLIS.match(record["time"])
    assert record["event"] == "extraction_failed"
    assert record["requestId"] == "req-synthetic-51"
    assert record["documentId"] == "doc-synthetic-51"


def test_level_labels_match_pino() -> None:
    expected = {
        logging.DEBUG: "debug",
        logging.INFO: "info",
        logging.WARNING: "warn",
        logging.ERROR: "error",
        logging.CRITICAL: "fatal",
    }
    logging.getLogger("requestflow_ai.test_jsonlog").setLevel(logging.DEBUG)
    for level, label in expected.items():
        assert capture(level, "probe", {})["level"] == label
