"""DOCX parsing with python-docx: body paragraphs and table cells in body order.

Segments:

* ``d-p{n}``: the n-th body paragraph (1-based; empty paragraphs count, produce no segment).
* ``d-t{t}-r{r}-c{c}``: the cell of body table ``t`` at row ``r`` and grid column ``c`` (1-based).
  A horizontally merged cell appears once, at its first grid column; a vertically merged
  continuation is skipped (its text lives in the first cell).

Text is collapsed to one line (line breaks inside a paragraph or cell become spaces), like every
other segment. Not read (documented limitation): headers/footers, text boxes, footnotes, comments,
block-level content controls, tables nested inside table cells (only the cell's own paragraphs).

Why not docling: its DOCX backend emits paragraphs and tables without a stable paragraph/cell
index. docling depends on python-docx already.

Safety: the zip is checked first (``ooxml.open_package``); python-docx parses with lxml and
``resolve_entities=False`` (no entity expansion, no external entities); macros (``.docm``) are
never read. ``MAX_SEGMENTS`` caps the output and ``MAX_BLOCKS`` every visited body paragraph and
table cell, empty ones included (they emit nothing but still cost time) ->
``DocumentTooLongError``.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from requestflow_ai.parsing.errors import DocumentParseError, DocumentTooLongError
from requestflow_ai.parsing.ooxml import open_package
from requestflow_ai.parsing.segments import DocxLocator, Segment

MAX_SEGMENTS = 10_000
MAX_BLOCKS = 100_000

_P = qn("w:p")
_TBL = qn("w:tbl")


def _one_line(text: str) -> str:
    return " ".join(text.split())


def parse_docx(data: bytes) -> list[Segment]:
    open_package(data).close()
    try:
        document: Any = Document(BytesIO(data))
    except Exception as exc:
        raise DocumentParseError("could not open document") from exc
    try:
        return _segments(document)
    except DocumentTooLongError:
        raise
    except Exception as exc:
        raise DocumentParseError("could not read document") from exc


def _segments(document: Any) -> list[Segment]:
    segments: list[Segment] = []

    def add(segment: Segment) -> None:
        if len(segments) >= MAX_SEGMENTS:
            raise DocumentTooLongError(f"document has more than {MAX_SEGMENTS} text blocks")
        segments.append(segment)

    visited = 0

    def visit() -> None:
        nonlocal visited
        visited += 1
        if visited > MAX_BLOCKS:
            raise DocumentTooLongError(f"document has more than {MAX_BLOCKS} paragraphs and cells")

    body = document.element.body
    paragraph_no = 0
    table_no = 0
    for element in body.iterchildren():
        if element.tag == _P:
            paragraph_no += 1
            visit()
            text = _one_line(Paragraph(element, document).text)
            if text:
                add(
                    Segment(
                        id=f"d-p{paragraph_no}",
                        text=text,
                        locator=DocxLocator(part="paragraph", paragraph=paragraph_no),
                    )
                )
        elif element.tag == _TBL:
            table_no += 1
            # Holds the elements themselves: lxml keeps one proxy per element while referenced.
            seen: set[Any] = set()
            for row_no, row in enumerate(Table(element, document).rows, start=1):
                for cell_no, cell in enumerate(row.cells, start=1):
                    visit()
                    if cell._tc in seen:  # merged cell already emitted
                        continue
                    seen.add(cell._tc)
                    text = _one_line(" ".join(p.text for p in cell.paragraphs))
                    if text:
                        add(
                            Segment(
                                id=f"d-t{table_no}-r{row_no}-c{cell_no}",
                                text=text,
                                locator=DocxLocator(
                                    part="table_cell", table=table_no, row=row_no, cell=cell_no
                                ),
                            )
                        )
    return segments
