"""#23 end to end over HTTP: XLSX, DOCX, MSG (partial failure) and the OCR cap.

Real parsers, real SDK, real verifier; the model is replayed at the HTTP boundary (hand-written,
synthetic ``generateContent`` bodies built below). OCR runs through a fake docling converter
(no model download in CI); the real OCR path is covered by the env-gated test in
``test_parsing_pdf.py``.
"""

from __future__ import annotations

import io
import json
import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from builders import DocxTable, MsgAttachment, MsgSpec, build_docx, build_msg, build_xlsx
from conftest import Replay
from docling_core.types.doc.base import BoundingBox as DocBox
from docling_core.types.doc.base import CoordOrigin, Size
from docling_core.types.doc.common.reference import ProvenanceItem
from docling_core.types.doc.document import DoclingDocument
from docling_core.types.doc.labels import DocItemLabel
from fastapi.testclient import TestClient
from test_api import build_app, upload

from requestflow_ai.jsonlog import JsonFormatter
from requestflow_ai.parsing import pdf as pdf_module

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
HEADER_KEYS = (
    "company",
    "contact_person",
    "email",
    "phone",
    "requested_delivery_date",
    "additional_requirements",
)


def missing() -> dict[str, Any]:
    return {"value": None, "status": "missing", "evidence": None}


def found(value: str, segment_id: str, quote: str) -> dict[str, Any]:
    return {"value": value, "status": "found", "evidence": {"segment_id": segment_id, "quote": quote}}


def vertex_body(fields: dict[str, Any], line_items: list[dict[str, Any]] | None = None) -> dict:
    extraction = {key: fields.get(key, missing()) for key in HEADER_KEYS}
    extraction["line_items"] = line_items or []
    return {
        "candidates": [
            {
                "content": {"role": "model", "parts": [{"text": json.dumps(extraction)}]},
                "finishReason": "STOP",
            }
        ],
        "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 50, "totalTokenCount": 150},
        "modelVersion": "gemini-3.5-flash",
        "responseId": "synthetic-formats",
    }


@pytest.fixture
def replay() -> Replay:
    return Replay(body=vertex_body({}))


def item(**fields: dict[str, Any]) -> dict[str, Any]:
    keys = ("description", "quantity", "unit", "material", "dimensions")
    return {key: fields.get(key, missing()) for key in keys}


def test_xlsx_upload_returns_row_locators_and_verified_line_item() -> None:
    data = build_xlsx(
        {
            "Anfrage": [
                ["Musterbau Beispiel GmbH"],
                ["Pos", "Artikel", "Menge", "Einheit"],
                [1, "Flansch DN50", 1250, "Stk."],
            ]
        }
    )
    replay = Replay(
        body=vertex_body(
            {"company": found("Musterbau Beispiel GmbH", "s1-r1", "Musterbau Beispiel GmbH")},
            [
                item(
                    description=found("Flansch DN50", "s1-r3", "Flansch DN50"),
                    quantity=found("1250", "s1-r3", "1250"),
                    unit=found("pcs", "s1-r3", "Stk."),
                )
            ],
        )
    )
    with TestClient(build_app(replay)) as client:
        response = upload(client, data, media_type=XLSX_TYPE)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["documentKind"] == "xlsx"
    assert body["run"]["pdfPipeline"] is None
    assert body["attachments"] == []
    row = next(s for s in body["segments"] if s["id"] == "s1-r3")
    assert row["text"] == "1 | Flansch DN50 | 1250 | Stk."
    assert row["locator"] == {"kind": "xlsx", "sheet": "Anfrage", "row": 3, "cellRange": "A3:D3"}
    assert body["fields"]["company"]["status"] == "found"
    (line,) = body["lineItems"]
    assert (line["quantity"]["status"], line["quantity"]["value"]) == ("found", "1250")
    assert (line["unit"]["status"], line["unit"]["value"]) == ("found", "pcs")
    assert "[s1-r3] 1 | Flansch DN50 | 1250 | Stk." in replay.request_json()["contents"][0][
        "parts"
    ][0]["text"]


def test_docx_upload_returns_paragraph_and_cell_locators() -> None:
    data = build_docx(["Musterbau Beispiel GmbH", DocxTable(rows=[["Liefertermin", "15.11.2026"]])])
    replay = Replay(
        body=vertex_body(
            {"requested_delivery_date": found("2026-11-15", "d-t1-r1-c2", "15.11.2026")}
        )
    )
    with TestClient(build_app(replay)) as client:
        response = upload(client, data)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["documentKind"] == "docx"
    by_id = {s["id"]: s for s in body["segments"]}
    assert by_id["d-p1"]["locator"] == {
        "kind": "docx",
        "part": "paragraph",
        "paragraph": 1,
        "table": None,
        "row": None,
        "cell": None,
    }
    assert by_id["d-t1-r1-c2"]["locator"]["part"] == "table_cell"
    date = body["fields"]["requested_delivery_date"]
    assert (date["status"], date["value"]) == ("found", "2026-11-15")


def _capture_logs() -> tuple[io.StringIO, logging.Handler]:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logging.getLogger().addHandler(handler)
    return stream, handler


def test_msg_with_a_corrupt_attachment_still_extracts_and_reports_it(fixtures_dir: Path) -> None:
    pdf = (fixtures_dir / "anfrage_musterbau.pdf").read_bytes()
    spec = MsgSpec(
        subject="Anfrage 2026-0815",
        sender_name="Erika Mustermann",
        sender_email="erika.mustermann@example.com",
        body="Guten Tag,\nbitte Angebot laut Anhang.\n",
        attachments=[
            MsgAttachment("geheimer-dateiname.pdf", b"%PDF-1.4\n% truncated synthetic garbage\n"),
            MsgAttachment("anfrage.pdf", pdf, "application/pdf"),
        ],
    )
    replay = Replay(
        body=vertex_body(
            {
                "company": found(
                    "Musterbau Beispiel GmbH", "msg-a1-p1-l1", "Musterbau Beispiel GmbH"
                ),
                "email": found(
                    "erika.mustermann@example.com", "msg-h-from", "erika.mustermann@example.com"
                ),
            }
        )
    )
    app = build_app(replay)  # before adding the handler: create_app configures logging
    stream, handler = _capture_logs()
    try:
        with TestClient(app) as client:
            response = upload(client, build_msg(spec), media_type="application/vnd.ms-outlook")
    finally:
        logging.getLogger().removeHandler(handler)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["documentKind"] == "msg"
    assert body["warnings"] == ["attachment_failed"]
    assert body["run"]["pdfPipeline"] == "textlines"  # the PDF attachment was parsed
    assert body["attachments"] == [
        {
            "path": [0],
            "name": "geheimer-dateiname.pdf",
            "documentKind": None,
            "status": "failed",
            "error": "document_unparseable",
            "segmentCount": 0,
        },
        {
            "path": [1],
            "name": "anfrage.pdf",
            "documentKind": "pdf",
            "status": "parsed",
            "error": None,
            "segmentCount": 8,
        },
    ]
    company = body["fields"]["company"]
    assert company["status"] == "found"
    segment = next(s for s in body["segments"] if s["id"] == "msg-a1-p1-l1")
    assert segment["locator"]["kind"] == "msg"
    assert segment["locator"]["attachment"] == {"index": 1, "name": "anfrage.pdf"}
    assert segment["locator"]["inner"]["kind"] == "pdf"
    assert segment["locator"]["inner"]["ocr"] is False
    assert body["fields"]["email"]["status"] == "found"

    output = stream.getvalue()
    completed = next(
        json.loads(line)
        for line in output.splitlines()
        if json.loads(line)["event"] == "extraction_completed"
    )
    assert completed["attachmentCount"] == 2
    assert completed["attachmentFailedCount"] == 1
    for content in ("geheimer-dateiname", "anfrage.pdf", "Musterbau", "Mustermann", "Anhang"):
        assert content not in output


def test_broken_top_level_msg_is_422(replay: Replay) -> None:
    broken = build_msg(MsgSpec(subject="s", body="b"))[:600]
    with TestClient(build_app(replay), raise_server_exceptions=False) as client:
        response = upload(client, broken)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "document_unparseable"
    assert replay.requests == []


def test_legacy_office_file_is_415(replay: Replay) -> None:
    from builders import build_cfb

    with TestClient(build_app(replay), raise_server_exceptions=False) as client:
        response = upload(client, build_cfb({"WordDocument": b"\x00" * 16}))
    assert response.status_code == 415


class _OcrConverter:
    """Stands in for docling's OCR pipeline: returns what it would read on the scanned page."""

    def __init__(self) -> None:
        self.initialized = 0

    def initialize_pipeline(self, _fmt: object) -> None:
        self.initialized += 1

    def convert(self, _stream: object, *, raises_on_error: bool, page_range: tuple[int, int]) -> Any:
        from docling.datamodel.base_models import ConversionStatus

        page_no = page_range[0]
        document = DoclingDocument(name="document")
        document.add_page(page_no=page_no, size=Size(width=595, height=842))
        for number, text in enumerate(["Musterbau Beispiel GmbH", "Liefertermin: 15.11.2026"]):
            top = 780 - number * 30
            document.add_text(
                label=DocItemLabel.TEXT,
                text=text,
                prov=ProvenanceItem(
                    page_no=page_no,
                    bbox=DocBox(
                        l=72, t=top, r=300, b=top - 14, coord_origin=CoordOrigin.BOTTOMLEFT
                    ),
                    charspan=(0, len(text)),
                ),
            )
        return SimpleNamespace(status=ConversionStatus.SUCCESS, document=document)


def test_scanned_pdf_is_ocrd_and_ocr_only_evidence_is_never_found(
    fixtures_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    converter = _OcrConverter()
    monkeypatch.setattr(pdf_module, "_ocr_converter", lambda: converter)
    replay = Replay(
        body=vertex_body(
            {
                "company": found("Musterbau Beispiel GmbH", "p1-o1", "Musterbau Beispiel GmbH"),
                "requested_delivery_date": found("2026-11-15", "p1-o2", "15.11.2026"),
            }
        )
    )
    with TestClient(build_app(replay, ai_pdf_ocr="auto")) as client:
        assert converter.initialized == 1  # built at startup (fail-closed)
        response = upload(client, (fixtures_dir / "anfrage_scan.pdf").read_bytes())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["warnings"] == []
    assert [s["locator"]["ocr"] for s in body["segments"]] == [True, True]
    for key, value in (("company", "Musterbau Beispiel GmbH"), ("requested_delivery_date", "2026-11-15")):
        result = body["fields"][key]
        assert (result["status"], result["reason"], result["value"]) == (
            "uncertain",
            "ocr_only",
            value,
        )
        assert result["modelStatus"] == "found"


def test_scanned_pdf_without_ocr_keeps_the_no_text_behaviour(
    fixtures_dir: Path, replay: Replay
) -> None:
    with TestClient(build_app(replay)) as client:
        response = upload(client, (fixtures_dir / "anfrage_scan.pdf").read_bytes())
    assert response.status_code == 200
    assert response.json()["warnings"] == ["no_text"]
    assert replay.requests == []


def test_ocr_setting_defaults_to_off() -> None:
    from conftest import make_settings

    assert make_settings().ai_pdf_ocr == "off"
