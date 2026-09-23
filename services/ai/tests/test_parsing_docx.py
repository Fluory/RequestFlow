"""DOCX parsing: body paragraphs and table cells in body order."""

from __future__ import annotations

import zipfile
from io import BytesIO

import pytest
from builders import DocxTable, build_docx

from requestflow_ai.parsing import docx as docx_module
from requestflow_ai.parsing.docx import parse_docx
from requestflow_ai.parsing.errors import DocumentParseError, DocumentTooLongError
from requestflow_ai.parsing.segments import DocxLocator

BLOCKS: list[str | DocxTable] = [
    "Musterbau Beispiel GmbH",
    "",
    "Anfrage   Nr. 2026-0815",
    DocxTable(
        rows=[
            ["Positionen", "", "Menge"],
            ["Flansch DN50", "1.4301", "1.250 Stk."],
        ],
        merge_first_row=True,
    ),
    "Liefertermin: 15.11.2026",
    DocxTable(rows=[["Toleranz", "ISO 2768-m"]]),
]


def test_paragraphs_and_table_cells_have_locators() -> None:
    segments = parse_docx(build_docx(BLOCKS))
    by_id = {s.id: s for s in segments}

    assert [s.id for s in segments] == [
        "d-p1",
        "d-p3",
        "d-t1-r1-c1",
        "d-t1-r1-c3",
        "d-t1-r2-c1",
        "d-t1-r2-c2",
        "d-t1-r2-c3",
        "d-p4",
        "d-t2-r1-c1",
        "d-t2-r1-c2",
    ]
    assert by_id["d-p1"].text == "Musterbau Beispiel GmbH"
    assert by_id["d-p1"].locator == DocxLocator(part="paragraph", paragraph=1)
    # Empty paragraphs count for the index but produce no segment; whitespace is collapsed.
    assert by_id["d-p3"].text == "Anfrage Nr. 2026-0815"
    # The paragraph after the first table is the 4th body paragraph.
    assert by_id["d-p4"].text == "Liefertermin: 15.11.2026"
    cell = by_id["d-t1-r2-c3"]
    assert cell.text == "1.250 Stk."
    assert cell.locator == DocxLocator(part="table_cell", table=1, row=2, cell=3)
    # A horizontally merged cell appears once, at its first grid column.
    assert by_id["d-t1-r1-c1"].text == "Positionen"


def test_segment_ids_are_stable() -> None:
    data = build_docx(BLOCKS)
    assert parse_docx(data) == parse_docx(data)


def test_segment_cap_is_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(docx_module, "MAX_SEGMENTS", 2)
    with pytest.raises(DocumentTooLongError):
        parse_docx(build_docx(["a", "b", "c"]))


def test_broken_document_is_a_parse_error() -> None:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", "<not-a-document")
    with pytest.raises(DocumentParseError):
        parse_docx(buffer.getvalue())
