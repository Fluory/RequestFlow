"""XLSX parsing: one segment per non-empty row, locator = sheet + row + cell range."""

from __future__ import annotations

import zipfile
from io import BytesIO

import pytest
from builders import build_xlsx

from requestflow_ai.parsing import xlsx as xlsx_module
from requestflow_ai.parsing.errors import DocumentParseError, DocumentTooLongError
from requestflow_ai.parsing.segments import XlsxLocator
from requestflow_ai.parsing.xlsx import parse_xlsx

WORKBOOK = {
    "Anfrage": [
        ["Musterbau Beispiel GmbH"],
        [],
        ["Pos", "Artikel", "Menge", "Einheit"],
        [1, "Flansch DN50", 1250, "Stk."],
        [2, "Dichtung 50x3 mm", 2.5, "kg"],
        [None, "  Lieferung   bis 15.11.2026 ", None, None],
    ],
    "Notizen": [[None, "Toleranz ISO 2768-m"]],
}


def test_one_segment_per_non_empty_row_with_sheet_row_and_range() -> None:
    segments = parse_xlsx(build_xlsx(WORKBOOK))
    by_id = {s.id: s for s in segments}

    assert [s.id for s in segments] == ["s1-r1", "s1-r3", "s1-r4", "s1-r5", "s1-r6", "s2-r1"]
    row = by_id["s1-r4"]
    assert row.text == "1 | Flansch DN50 | 1250 | Stk."
    assert row.locator == XlsxLocator(sheet="Anfrage", row=4, cell_range="A4:D4")
    assert by_id["s1-r5"].text == "2 | Dichtung 50x3 mm | 2.5 | kg"
    # Empty cells are skipped, whitespace collapsed, the range spans the non-empty cells.
    assert by_id["s1-r6"].text == "Lieferung bis 15.11.2026"
    assert by_id["s1-r6"].locator == XlsxLocator(sheet="Anfrage", row=6, cell_range="B6")
    assert by_id["s2-r1"].locator == XlsxLocator(sheet="Notizen", row=1, cell_range="B1")


def test_segment_ids_are_stable() -> None:
    data = build_xlsx(WORKBOOK)
    assert parse_xlsx(data) == parse_xlsx(data)


def test_formulas_are_never_evaluated_only_cached_values_are_read() -> None:
    # openpyxl writes no cached value for a formula: the cell reads as empty, never as formula
    # text and never computed.
    data = build_xlsx({"S": [["Menge", "=1+1"]]})
    (segment,) = parse_xlsx(data)
    assert segment.text == "Menge"


def test_row_cap_is_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(xlsx_module, "MAX_ROWS", 3)
    with pytest.raises(DocumentTooLongError):
        parse_xlsx(build_xlsx({"S": [["a"], ["b"], ["c"], ["d"]]}))


def test_broken_workbook_is_a_parse_error() -> None:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("xl/workbook.xml", "<not-a-workbook")
    with pytest.raises(DocumentParseError):
        parse_xlsx(buffer.getvalue())
