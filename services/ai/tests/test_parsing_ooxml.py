"""Zip-level limits for OOXML (XLSX/DOCX) before any XML is parsed."""

from __future__ import annotations

import zipfile
from io import BytesIO

import pytest
from builders import build_docx, build_xlsx

from requestflow_ai.parsing import ooxml
from requestflow_ai.parsing.errors import (
    DocumentParseError,
    DocumentTooLongError,
    UnsupportedMediaTypeError,
)
from requestflow_ai.parsing.ooxml import open_package, package_kind


def _zip(entries: dict[str, bytes], level: int = zipfile.ZIP_DEFLATED) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=level) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def test_package_kind_from_the_main_part() -> None:
    assert package_kind(open_package(build_xlsx({"S": [["a"]]}))) == "xlsx"
    assert package_kind(open_package(build_docx(["a"]))) == "docx"
    assert package_kind(open_package(_zip({"readme.txt": b"plain zip"}))) is None


def test_not_a_zip_is_unsupported() -> None:
    with pytest.raises(UnsupportedMediaTypeError):
        open_package(b"PK\x03\x04 zip container")


def test_highly_compressed_entry_is_rejected_as_a_zip_bomb() -> None:
    bomb = _zip({"word/document.xml": b"\x00" * (4 * 1024 * 1024)})
    with pytest.raises(DocumentParseError):
        open_package(bomb)


def test_total_uncompressed_size_is_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ooxml, "MAX_UNCOMPRESSED_BYTES", 1000)
    with pytest.raises(DocumentParseError):
        open_package(_zip({"a.xml": b"x" * 600, "b.xml": b"y" * 600}, zipfile.ZIP_STORED))


def test_entry_count_is_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ooxml, "MAX_ENTRIES", 3)
    with pytest.raises(DocumentParseError):
        open_package(_zip({f"{i}.xml": b"x" for i in range(4)}))


def test_single_part_over_the_part_cap_is_rejected_before_decompression(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Any part: python-docx/openpyxl choose the XML parser by content type, not by file name.
    package = build_docx(["a"])
    with zipfile.ZipFile(BytesIO(package)) as archive:
        largest = max(entry.file_size for entry in archive.infolist())
    monkeypatch.setattr(ooxml, "MAX_PART_BYTES", largest)
    open_package(package).close()  # every part within the cap
    with pytest.raises(DocumentTooLongError):
        open_package(_zip({"word/document.xml": b"<w:p/>" * (largest // 6 + 1)}))
    with pytest.raises(DocumentTooLongError):
        open_package(_zip({"word/media/anything.bin": bytes(range(256)) * (largest // 256 + 1)}))
