"""HTTP API: auth, contract shape, error mapping, logging hygiene."""

from __future__ import annotations

import asyncio
import io
import json
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import TEST_TOKEN, Replay, fake_credentials, make_settings, no_adc, recorded
from fastapi import FastAPI
from fastapi.testclient import TestClient

from requestflow_ai.api.app import MULTIPART_OVERHEAD_BYTES, create_app
from requestflow_ai.extraction.model_client import build_model_client
from requestflow_ai.jsonlog import JsonFormatter

AUTH = {"Authorization": f"Bearer {TEST_TOKEN}"}


def build_app(replay: Replay, **overrides: Any) -> FastAPI:
    settings = make_settings(**overrides)
    model = build_model_client(
        settings,
        credentials=fake_credentials(),
        httpx_client=replay.client(),
        credentials_loader=no_adc,
    )
    return create_app(settings, model_client=model)


@pytest.fixture
def replay() -> Replay:
    return Replay(body=recorded("musterbau_pdf.json"))


@pytest.fixture
def client(replay: Replay) -> Iterator[TestClient]:
    with TestClient(build_app(replay), raise_server_exceptions=False) as test_client:
        yield test_client


def upload(
    client: TestClient,
    data: bytes,
    *,
    headers: dict[str, str] | None = None,
    document_id: str | None = "doc-0001",
    media_type: str | None = None,
) -> Any:
    form: dict[str, str] = {}
    if document_id is not None:
        form["documentId"] = document_id
    if media_type is not None:
        form["mediaType"] = media_type
    return client.post(
        "/v1/extract",
        headers=AUTH if headers is None else headers,
        data=form,
        files={"file": ("upload.bin", data, "application/octet-stream")},
    )


def pdf_bytes(fixtures_dir: Path) -> bytes:
    return (fixtures_dir / "anfrage_musterbau.pdf").read_bytes()


def test_healthz_needs_no_auth(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer wrong-token-wrong-token-wrong"},
        {"Authorization": f"Basic {TEST_TOKEN}"},
        {"Authorization": f"Bearer {TEST_TOKEN}x"},
        {"Authorization": "Bearer"},
    ],
)
def test_extract_rejects_missing_or_wrong_token(
    client: TestClient, replay: Replay, fixtures_dir: Path, headers: dict[str, str]
) -> None:
    response = upload(client, pdf_bytes(fixtures_dir), headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "unauthorized"
    assert replay.requests == []


def test_extract_pdf_returns_segments_fields_and_run_metadata(
    client: TestClient, fixtures_dir: Path
) -> None:
    response = upload(
        client, pdf_bytes(fixtures_dir), headers={**AUTH, "X-Request-Id": "req-abc-123"}
    )
    assert response.status_code == 200, response.text
    assert response.headers["x-request-id"] == "req-abc-123"
    body = response.json()
    assert body["requestId"] == "req-abc-123"
    assert body["documentId"] == "doc-0001"
    assert body["documentKind"] == "pdf"
    assert body["warnings"] == []

    first = body["segments"][0]
    assert first["id"] == "p1-l1"
    assert first["locator"]["kind"] == "pdf"
    assert first["locator"]["page"] == 1
    assert first["locator"]["coordOrigin"] == "TOPLEFT"
    assert set(first["locator"]["bbox"]) == {"l", "t", "r", "b"}

    assert set(body["fields"]) == {"company", "contact_person", "requested_delivery_date"}
    company = body["fields"]["company"]
    assert company == {
        "value": "Musterbau Beispiel GmbH",
        "status": "found",
        "modelStatus": "found",
        "reason": None,
        "evidence": {"segmentId": "p1-l1", "quote": "Musterbau Beispiel GmbH"},
    }

    run = body["run"]
    assert run["modelId"] == "gemini-3.5-flash"
    assert run["modelVersion"] == "gemini-3.5-flash"
    assert run["promptVersion"] == "extract_header_v1"
    assert run["schemaVersion"] == "header-v1"
    assert run["pdfPipeline"] == "textlines"
    assert run["tokens"] == {"inputTokens": 612, "outputTokens": 141, "totalTokens": 753}
    assert isinstance(run["latencyMs"], int)
    assert isinstance(run["modelLatencyMs"], int)


def test_eml_segments_use_email_locators(fixtures_dir: Path) -> None:
    replay = Replay(body=recorded("musterbau_eml.json"))
    with TestClient(build_app(replay)) as client:
        response = upload(
            client,
            (fixtures_dir / "anfrage_musterbau.eml").read_bytes(),
            media_type="message/rfc822",
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["documentKind"] == "eml"
    by_id = {s["id"]: s for s in body["segments"]}
    assert by_id["eml-l9"]["locator"] == {
        "kind": "email",
        "part": "body",
        "line": 9,
        "header": None,
    }
    assert body["run"]["pdfPipeline"] is None
    assert body["fields"]["requested_delivery_date"]["status"] == "unverified"


@pytest.mark.parametrize("request_id", ["x" * 200, "bad id with spaces", "<script>"])
def test_invalid_request_id_is_replaced(
    client: TestClient, fixtures_dir: Path, request_id: str
) -> None:
    response = upload(client, pdf_bytes(fixtures_dir), headers={**AUTH, "X-Request-Id": request_id})
    assert response.status_code == 200
    assert response.headers["x-request-id"] != request_id
    assert response.json()["requestId"] == response.headers["x-request-id"]


@pytest.mark.parametrize("document_id", [None, "", "has space", "a" * 200])
def test_invalid_document_id_is_400_without_echo(
    client: TestClient, fixtures_dir: Path, document_id: str | None
) -> None:
    response = upload(client, pdf_bytes(fixtures_dir), document_id=document_id)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    if document_id:
        assert document_id not in response.text


def test_document_too_large_is_413(fixtures_dir: Path, replay: Replay) -> None:
    with TestClient(build_app(replay, ai_max_document_bytes=100)) as client:
        response = upload(client, pdf_bytes(fixtures_dir))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "document_too_large"
    assert replay.requests == []


def test_unsupported_document_is_415(client: TestClient) -> None:
    response = upload(client, b"PK\x03\x04 zip container")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_media_type"


def test_unparseable_pdf_is_422(client: TestClient) -> None:
    response = upload(client, b"%PDF-1.4\n% truncated synthetic garbage\n")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "document_unparseable"


def test_model_failure_is_502_without_upstream_detail(fixtures_dir: Path) -> None:
    replay = Replay(status=500, body={"error": {"code": 500, "message": "upstream-secret-detail"}})
    with TestClient(build_app(replay)) as client:
        response = upload(client, pdf_bytes(fixtures_dir))
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "model_error"
    assert "upstream-secret-detail" not in response.text


def test_invalid_model_output_is_502(fixtures_dir: Path) -> None:
    body = recorded("musterbau_pdf.json")
    body["candidates"][0]["content"]["parts"][0]["text"] = "Musterbau Beispiel GmbH is the company"
    with TestClient(build_app(Replay(body=body))) as client:
        response = upload(client, pdf_bytes(fixtures_dir))
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "model_output_invalid"
    assert "Musterbau" not in response.text


def test_busy_service_returns_429(client: TestClient, fixtures_dir: Path) -> None:
    slots = client.app.state.extraction_slots  # type: ignore[attr-defined]
    held = 0
    while slots.acquire(blocking=False):
        held += 1
    try:
        response = upload(client, pdf_bytes(fixtures_dir))
    finally:
        for _ in range(held):
            slots.release()
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "busy"


def test_logs_are_json_with_ids_only_never_content_or_token(
    client: TestClient, fixtures_dir: Path
) -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        ok = upload(client, pdf_bytes(fixtures_dir), headers={**AUTH, "X-Request-Id": "req-log-1"})
        bad = upload(client, b"%PDF-1.4\n% broken\n", document_id="doc-broken")
    finally:
        root.removeHandler(handler)
    assert ok.status_code == 200
    assert bad.status_code == 422

    output = stream.getvalue()
    records = [json.loads(line) for line in output.splitlines()]
    events = {r["event"] for r in records}
    assert {"extraction_completed", "request_completed", "extraction_failed"} <= events
    completed = next(r for r in records if r["event"] == "extraction_completed")
    assert completed["requestId"] == "req-log-1"
    assert completed["documentId"] == "doc-0001"
    assert completed["inputTokens"] == 612

    for secret_or_content in (
        TEST_TOKEN,
        "Musterbau",
        "Mustermann",
        "15.11.2026",
        "Liefertermin",
    ):
        assert secret_or_content not in output


def call_asgi(
    app: FastAPI, headers: dict[str, str], *, path: str = "/v1/extract", root_path: str = ""
) -> tuple[int, dict[str, str], dict[str, Any]]:
    """Call the app without a client, with a body that fails the test if anything reads it."""
    sent: list[dict[str, Any]] = []
    reads: list[bool] = []

    async def receive() -> dict[str, Any]:
        # Recorded as well as raised: the app might swallow the exception.
        reads.append(True)
        raise AssertionError("the request body must not be read")

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope: dict[str, Any] = {
        "type": "http",
        # spec 2.4: responses do not listen for a disconnect (which would call receive).
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": root_path,
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }
    asyncio.run(app(scope, receive, send))  # type: ignore[arg-type]
    assert reads == [], "the request body was read"
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    response_headers = {k.decode().lower(): v.decode() for k, v in start["headers"]}
    return start["status"], response_headers, json.loads(body)


MULTIPART = {"content-type": "multipart/form-data; boundary=synthetic"}


@pytest.mark.parametrize(
    "auth",
    [
        {},
        {"authorization": "Bearer wrong-token-wrong-token-wrong"},
        {"authorization": f"Basic {TEST_TOKEN}"},
    ],
)
def test_unauthenticated_request_is_rejected_before_the_body_is_read(
    replay: Replay, auth: dict[str, str]
) -> None:
    # A huge declared body: without a valid token nothing is read, spooled or parsed.
    app = build_app(replay)
    headers = {**MULTIPART, **auth, "content-length": str(10**12), "x-request-id": "req-401-1"}
    status, response_headers, body = call_asgi(app, headers)
    assert status == 401
    assert response_headers["www-authenticate"] == "Bearer"
    assert response_headers["x-request-id"] == "req-401-1"
    assert body == {
        "error": {"code": "unauthorized", "message": "missing or invalid bearer token"},
        "requestId": "req-401-1",
    }
    assert replay.requests == []


def test_guard_also_applies_behind_a_proxy_root_path(replay: Replay) -> None:
    # uvicorn --root-path /ai: scope["path"] includes the prefix.
    headers = {**MULTIPART, "content-length": str(10**12)}
    status, _, body = call_asgi(
        build_app(replay), headers, path="/ai/v1/extract", root_path="/ai"
    )
    assert status == 401
    assert body["error"]["code"] == "unauthorized"


@pytest.mark.parametrize("length", [None, "", "abc", "-1", "1e3", "12 34"])
def test_missing_or_invalid_content_length_is_411_before_reading(
    replay: Replay, length: str | None
) -> None:
    headers = {**MULTIPART, "authorization": f"Bearer {TEST_TOKEN}"}
    if length is not None:
        headers["content-length"] = length
    status, _, body = call_asgi(build_app(replay), headers)
    assert status == 411
    assert body["error"]["code"] == "length_required"
    assert body["requestId"]


def test_declared_length_above_the_limit_is_413_before_reading(replay: Replay) -> None:
    app = build_app(replay, ai_max_document_bytes=1000)
    headers = {
        **MULTIPART,
        "authorization": f"Bearer {TEST_TOKEN}",
        "content-length": str(1000 + MULTIPART_OVERHEAD_BYTES + 1),
    }
    status, _, body = call_asgi(app, headers)
    assert status == 413
    assert body["error"]["code"] == "document_too_large"


def test_body_within_declared_allowance_still_hits_the_exact_byte_limit(
    fixtures_dir: Path, replay: Replay
) -> None:
    # Declared length passes the early check (overhead allowance); the file itself is too big.
    data = pdf_bytes(fixtures_dir)
    assert len(data) < MULTIPART_OVERHEAD_BYTES
    with TestClient(build_app(replay, ai_max_document_bytes=len(data) - 1)) as client:
        response = upload(client, data)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "document_too_large"
    assert replay.requests == []


def capture_logs() -> tuple[io.StringIO, logging.Handler]:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logging.getLogger().addHandler(handler)
    return stream, handler


def test_unexpected_error_in_extract_is_500_with_request_and_document_id(
    client: TestClient, fixtures_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_: Any, **__: Any) -> Any:
        raise RuntimeError("secret document text Musterbau")

    monkeypatch.setattr("requestflow_ai.api.app.run_extraction", boom)
    stream, handler = capture_logs()
    try:
        response = upload(
            client,
            pdf_bytes(fixtures_dir),
            headers={**AUTH, "X-Request-Id": "req-500-1"},
            document_id="doc-500",
        )
    finally:
        logging.getLogger().removeHandler(handler)

    assert response.status_code == 500
    assert response.headers["x-request-id"] == "req-500-1"
    assert response.json() == {
        "error": {"code": "internal_error", "message": "internal error"},
        "requestId": "req-500-1",
    }
    output = stream.getvalue()
    assert "secret document text" not in output
    assert "Musterbau" not in output
    records = [json.loads(line) for line in output.splitlines()]
    error = next(r for r in records if r["event"] == "unhandled_error")
    assert error["requestId"] == "req-500-1"
    assert error["documentId"] == "doc-500"
    assert error["excType"] == "RuntimeError"
    # The slot was released: the next request can run.
    monkeypatch.undo()
    assert upload(client, pdf_bytes(fixtures_dir)).status_code == 200


def test_unexpected_error_outside_extract_is_500_with_request_id(replay: Replay) -> None:
    app = build_app(replay)

    async def broken() -> None:
        raise RuntimeError("secret detail")

    app.add_api_route("/v1/broken", broken, methods=["GET"])
    stream, handler = capture_logs()
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/v1/broken", headers={"X-Request-Id": "req-500-2"})
    finally:
        logging.getLogger().removeHandler(handler)

    assert response.status_code == 500
    assert response.headers["x-request-id"] == "req-500-2"
    assert response.json()["requestId"] == "req-500-2"
    assert response.json()["error"]["code"] == "internal_error"
    output = stream.getvalue()
    assert "secret detail" not in output
    records = [json.loads(line) for line in output.splitlines()]
    error = next(r for r in records if r["event"] == "unhandled_error")
    assert error["requestId"] == "req-500-2"
    assert error["excType"] == "RuntimeError"


def test_pdf_over_the_page_cap_is_422_without_a_model_call(
    fixtures_dir: Path, replay: Replay
) -> None:
    with TestClient(build_app(replay, ai_max_pdf_pages=1)) as client:
        response = upload(client, pdf_bytes(fixtures_dir))  # 2 pages
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "document_too_long"
    assert replay.requests == []


def test_max_pdf_pages_defaults_to_50() -> None:
    assert make_settings().ai_max_pdf_pages == 50


def test_layout_pipeline_without_model_refuses_to_start(
    replay: Replay, monkeypatch: pytest.MonkeyPatch
) -> None:
    from requestflow_ai.parsing import pdf as pdf_module
    from requestflow_ai.parsing.errors import PdfPipelineInitError

    class MissingModel:
        def initialize_pipeline(self, _: object) -> None:
            raise FileNotFoundError("layout model not found")

    monkeypatch.setattr(pdf_module, "_layout_converter", MissingModel)
    with pytest.raises(PdfPipelineInitError):
        build_app(replay, ai_pdf_pipeline="layout")


def test_service_refuses_to_start_without_token(monkeypatch: pytest.MonkeyPatch) -> None:
    from pydantic import ValidationError

    from requestflow_ai.config import Settings

    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    with pytest.raises(ValidationError):
        Settings()  # type: ignore[call-arg]


def test_short_token_is_rejected_without_echoing_it() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError) as excinfo:
        make_settings(ai_service_token="short-secret-value")
    assert "short-secret-value" not in str(excinfo.value)


def test_settings_have_no_database_or_storage_credentials() -> None:
    from requestflow_ai.config import Settings

    names = " ".join(Settings.model_fields).lower()
    for forbidden in ("database", "postgres", "db_", "s3", "storage", "bucket"):
        assert forbidden not in names
