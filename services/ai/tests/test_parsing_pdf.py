"""PDF parsing through docling (docling-parse text lines, layout, OCR of text-less pages).

Model-free except the tests marked ``docling``, which need cached models and
``AI_TEST_DOCLING_MODELS=1``.
"""

from __future__ import annotations

import os
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from docling_core.types.doc.base import BoundingBox as DocBox
from docling_core.types.doc.base import CoordOrigin, Size
from docling_core.types.doc.common.reference import ProvenanceItem
from docling_core.types.doc.document import DoclingDocument
from docling_core.types.doc.labels import DocItemLabel
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from requestflow_ai.parsing import pdf as pdf_module
from requestflow_ai.parsing.errors import (
    DocumentParseError,
    DocumentTooLongError,
    PdfPipelineInitError,
)
from requestflow_ai.parsing.pdf import (
    parse_pdf,
    parse_pdf_layout,
    parse_pdf_textlines,
    prepare_pdf_pipeline,
)
from requestflow_ai.parsing.segments import PdfLocator


def test_pdf_textlines_have_page_and_bbox(fixtures_dir: Path) -> None:
    segments = parse_pdf_textlines((fixtures_dir / "anfrage_musterbau.pdf").read_bytes())
    by_id = {s.id: s for s in segments}

    first = by_id["p1-l1"]
    assert first.text == "Musterbau Beispiel GmbH"
    assert isinstance(first.locator, PdfLocator)
    assert first.locator.page == 1
    assert first.locator.coord_origin == "TOPLEFT"
    bbox = first.locator.bbox
    # reportlab drew the line at x=72pt, baseline 780pt from the bottom of an A4 page (842pt).
    assert bbox.l == pytest.approx(72, abs=1)
    assert 40 < bbox.t < bbox.b < 70

    assert by_id["p1-l6"].text == "Gewuenschter Liefertermin: 15.11.2026"
    assert by_id["p2-l1"].text == "Technische Anforderungen"


def test_pdf_segments_are_ordered_by_page(fixtures_dir: Path) -> None:
    segments = parse_pdf_textlines((fixtures_dir / "anfrage_musterbau.pdf").read_bytes())
    pages = [s.locator.page for s in segments if isinstance(s.locator, PdfLocator)]
    assert pages == sorted(pages)
    assert len(segments) == 8


def test_pdf_segment_ids_are_stable(fixtures_dir: Path) -> None:
    data = (fixtures_dir / "anfrage_musterbau.pdf").read_bytes()
    assert parse_pdf_textlines(data) == parse_pdf_textlines(data)


def test_broken_pdf_raises_parse_error() -> None:
    with pytest.raises(DocumentParseError):
        parse_pdf_textlines(b"%PDF-1.4\n% truncated synthetic garbage\n")


def test_pdf_over_the_page_cap_is_rejected(fixtures_dir: Path) -> None:
    data = (fixtures_dir / "anfrage_musterbau.pdf").read_bytes()  # 2 pages
    with pytest.raises(DocumentTooLongError):
        parse_pdf_textlines(data, max_pages=1)
    assert len(parse_pdf_textlines(data, max_pages=2)) == 8


def test_layout_pipeline_checks_the_page_cap_before_the_model(
    fixtures_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_model() -> object:
        raise AssertionError("the layout converter must not be used for a too long PDF")

    monkeypatch.setattr(pdf_module, "_layout_converter", no_model)
    data = (fixtures_dir / "anfrage_musterbau.pdf").read_bytes()
    with pytest.raises(DocumentTooLongError):
        parse_pdf(data, "layout", max_pages=1)


class _Converter:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.initialized: list[object] = []

    def initialize_pipeline(self, fmt: object) -> None:
        self.initialized.append(fmt)
        if self.error is not None:
            raise self.error


def test_layout_pipeline_without_model_fails_at_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    # Simulates what docling raises offline without the cached layout model.
    converter = _Converter(FileNotFoundError("layout model not found"))
    monkeypatch.setattr(pdf_module, "_layout_converter", lambda: converter)
    with pytest.raises(PdfPipelineInitError):
        prepare_pdf_pipeline("layout")
    assert len(converter.initialized) == 1


def test_layout_pipeline_with_model_is_initialised_at_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    converter = _Converter()
    monkeypatch.setattr(pdf_module, "_layout_converter", lambda: converter)
    prepare_pdf_pipeline("layout")
    assert len(converter.initialized) == 1


def test_textlines_pipeline_needs_no_startup_model(monkeypatch: pytest.MonkeyPatch) -> None:
    def no_model() -> object:
        raise AssertionError("textlines must not build the layout converter")

    monkeypatch.setattr(pdf_module, "_layout_converter", no_model)
    prepare_pdf_pipeline("textlines")


@pytest.mark.docling
@pytest.mark.skipif(
    os.environ.get("AI_TEST_DOCLING_MODELS") != "1",
    reason="needs docling layout model in the HF cache (set AI_TEST_DOCLING_MODELS=1)",
)
def test_pdf_layout_pipeline_blocks_have_page_and_bbox(fixtures_dir: Path) -> None:
    segments = parse_pdf_layout((fixtures_dir / "anfrage_musterbau.pdf").read_bytes())
    assert segments, "layout pipeline produced no segments"
    first = segments[0]
    assert isinstance(first.locator, PdfLocator)
    assert first.locator.page == 1
    assert first.id == "p1-b1"
    assert "Musterbau Beispiel GmbH" in first.text
    assert first.locator.bbox.t < first.locator.bbox.b


# --- OCR for pages without a text layer (#23) -------------------------------------------------


def _ocr_document(page_no: int, lines: list[str]) -> DoclingDocument:
    """What docling's OCR pipeline returns for one page (built with docling-core, no model)."""
    document = DoclingDocument(name="document")
    document.add_page(page_no=page_no, size=Size(width=595, height=842))
    for number, text in enumerate(lines):
        top = 780 - number * 30
        document.add_text(
            label=DocItemLabel.TEXT,
            text=text,
            prov=ProvenanceItem(
                page_no=page_no,
                bbox=DocBox(l=72, t=top, r=300, b=top - 14, coord_origin=CoordOrigin.BOTTOMLEFT),
                charspan=(0, len(text)),
            ),
        )
    return document


class _OcrConverter:
    def __init__(self, lines: list[str]) -> None:
        self.lines = lines
        self.page_ranges: list[tuple[int, int]] = []
        self.initialized: list[object] = []

    def convert(
        self, _stream: object, *, raises_on_error: bool, page_range: tuple[int, int]
    ) -> Any:
        from docling.datamodel.base_models import ConversionStatus

        assert raises_on_error is False
        self.page_ranges.append(page_range)
        return SimpleNamespace(
            status=ConversionStatus.SUCCESS, document=_ocr_document(page_range[0], self.lines)
        )

    def initialize_pipeline(self, fmt: object) -> None:
        self.initialized.append(fmt)


def _mixed_pdf() -> bytes:
    """Page 1 has a text layer, page 2 only graphics (stands in for a scanned page)."""
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, invariant=True)
    pdf.setFont("Helvetica", 12)
    pdf.drawString(72, 780, "Musterbau Beispiel GmbH")
    pdf.showPage()
    pdf.rect(72, 600, 300, 150, stroke=1, fill=0)
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def test_ocr_runs_only_on_pages_without_text_and_flags_its_segments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    converter = _OcrConverter(["Liefertermin:  15.11.2026"])
    monkeypatch.setattr(pdf_module, "_ocr_converter", lambda: converter)
    segments = parse_pdf(_mixed_pdf(), "textlines", ocr="auto")

    assert converter.page_ranges == [(2, 2)]
    assert [s.id for s in segments] == ["p1-l1", "p2-o1"]
    text_line, ocr_line = segments
    assert isinstance(text_line.locator, PdfLocator)
    assert text_line.locator.ocr is False
    assert ocr_line.text == "Liefertermin: 15.11.2026"
    assert isinstance(ocr_line.locator, PdfLocator)
    assert ocr_line.locator.ocr is True
    assert ocr_line.locator.page == 2
    assert 40 < ocr_line.locator.bbox.t < ocr_line.locator.bbox.b < 90


def test_ocr_off_leaves_scanned_pages_empty(
    fixtures_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_ocr() -> object:
        raise AssertionError("OCR must not run when AI_PDF_OCR=off")

    monkeypatch.setattr(pdf_module, "_ocr_converter", no_ocr)
    assert parse_pdf((fixtures_dir / "anfrage_scan.pdf").read_bytes(), "textlines") == []


def test_pdf_with_text_on_every_page_is_never_ocrd(
    fixtures_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_ocr() -> object:
        raise AssertionError("pages with a text layer must not be OCR'd")

    monkeypatch.setattr(pdf_module, "_ocr_converter", no_ocr)
    data = (fixtures_dir / "anfrage_musterbau.pdf").read_bytes()
    assert len(parse_pdf(data, "textlines", ocr="auto")) == 8


def test_ocr_page_cap(fixtures_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pdf_module, "MAX_OCR_PAGES", 0)
    monkeypatch.setattr(pdf_module, "_ocr_converter", lambda: _OcrConverter(["x"]))
    with pytest.raises(DocumentTooLongError):
        parse_pdf((fixtures_dir / "anfrage_scan.pdf").read_bytes(), "textlines", ocr="auto")


def test_ocr_pipeline_is_built_at_startup_and_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    converter = _OcrConverter([])
    monkeypatch.setattr(pdf_module, "_ocr_converter", lambda: converter)
    prepare_pdf_pipeline("textlines", ocr="auto")
    assert len(converter.initialized) == 1

    broken = _Converter(FileNotFoundError("RapidOCR models not found"))
    monkeypatch.setattr(pdf_module, "_ocr_converter", lambda: broken)
    with pytest.raises(PdfPipelineInitError):
        prepare_pdf_pipeline("textlines", ocr="auto")


@pytest.mark.docling
@pytest.mark.skipif(
    os.environ.get("AI_TEST_DOCLING_MODELS") != "1",
    reason="needs the docling layout and RapidOCR models (set AI_TEST_DOCLING_MODELS=1)",
)
def test_real_ocr_reads_the_scanned_fixture(fixtures_dir: Path) -> None:
    segments = parse_pdf((fixtures_dir / "anfrage_scan.pdf").read_bytes(), "textlines", ocr="auto")
    assert segments, "OCR produced no segments"
    assert all(isinstance(s.locator, PdfLocator) and s.locator.ocr for s in segments)
    assert all(s.id.startswith("p1-o") for s in segments)
    text = " ".join(s.text for s in segments)
    assert "Musterbau" in text
    assert "15.11.2026" in text
