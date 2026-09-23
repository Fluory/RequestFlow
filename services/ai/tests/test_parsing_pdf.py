"""PDF parsing through docling's own PDF parser (docling-parse), model-free."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

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
