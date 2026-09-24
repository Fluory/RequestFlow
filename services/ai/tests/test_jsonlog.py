"""The AI service log line has the same shape as the web/worker pino lines (#51)."""

from __future__ import annotations

import io
import json
import logging
import re

from requestflow_ai.jsonlog import JsonFormatter, document_id_var, request_id_var

ISO_UTC_MILLIS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def capture_line(
    level: int,
    event: str,
    extra: dict[str, object],
    name: str = "requestflow_ai.test_jsonlog",
    exc_info: bool = False,
) -> str:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger(name)
    logger.addHandler(handler)
    propagate = logger.propagate
    logger.propagate = False
    request_token = request_id_var.set("req-synthetic-51")
    document_token = document_id_var.set("doc-synthetic-51")
    try:
        logger.log(level, event, extra=extra, exc_info=exc_info)
    finally:
        request_id_var.reset(request_token)
        document_id_var.reset(document_token)
        logger.removeHandler(handler)
        logger.propagate = propagate
    lines = stream.getvalue().splitlines()
    assert len(lines) == 1
    return lines[0]


def capture(level: int, event: str, extra: dict[str, object]) -> dict[str, object]:
    return json.loads(capture_line(level, event, extra))


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


def test_line_is_compact_like_pino() -> None:
    line = capture_line(logging.INFO, "request_completed", {"status": 200})
    assert ", " not in line
    assert '":' in line and '": ' not in line


def test_exception_names_only_its_type_never_its_message() -> None:
    try:
        raise ValueError("Musterbau GmbH, max@example.com")
    except ValueError:
        line = capture_line(logging.ERROR, "extraction_failed", {}, exc_info=True)
    record = json.loads(line)
    assert record["excType"] == "ValueError"
    assert "Musterbau" not in line
    assert "example.com" not in line


def test_library_records_name_their_logger_ours_do_not() -> None:
    assert "logger" not in json.loads(capture_line(logging.WARNING, "x", {}))
    library = json.loads(capture_line(logging.WARNING, "x", {}, name="docling.synthetic"))
    assert library["logger"] == "docling.synthetic"
