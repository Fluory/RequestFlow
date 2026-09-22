"""PDF parsing through docling's own PDF parser (docling-parse), model-free."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from requestflow_ai.parsing.errors import DocumentParseError
from requestflow_ai.parsing.pdf import parse_pdf_layout, parse_pdf_textlines
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
