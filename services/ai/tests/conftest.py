"""Shared test setup. The suite never downloads models and never calls a live endpoint."""

from __future__ import annotations

import os
from pathlib import Path

# Set before anything imports huggingface_hub/docling: a test that needed a model download
# fails instead of silently reaching the network.
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import pytest

from requestflow_ai.parsing.segments import BoundingBox, EmailLocator, PdfLocator, Segment

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES


def pdf_segment(segment_id: str, text: str, page: int = 1) -> Segment:
    return Segment(
        id=segment_id,
        text=text,
        locator=PdfLocator(page=page, bbox=BoundingBox(l=72, t=50, r=300, b=62)),
    )


def body_segment(segment_id: str, text: str, line: int = 1) -> Segment:
    return Segment(id=segment_id, text=text, locator=EmailLocator(part="body", line=line))
