"""Open an OOXML package (XLSX/DOCX) as a zip with limits checked before any XML is parsed.

Office Open XML files are zip archives. A hostile upload can be a zip bomb (tiny compressed,
huge uncompressed) or carry thousands of entries. ``open_package`` reads only the central
directory and rejects the package when

* it has more than ``MAX_ENTRIES`` entries,
* the declared uncompressed sizes add up to more than ``MAX_UNCOMPRESSED_BYTES``, or
* an entry larger than ``RATIO_CHECK_MIN_BYTES`` is compressed more than ``MAX_RATIO`` : 1.

The declared sizes are binding: Python's ``zipfile`` stops at an entry's declared size and fails
on a CRC mismatch, so an entry cannot inflate beyond what the central directory says.
Macros (``vbaProject.bin`` in ``.xlsm``/``.docm``) are never read, let alone executed.
"""

from __future__ import annotations

import zipfile
from io import BytesIO
from typing import Literal

from requestflow_ai.parsing.errors import DocumentParseError, UnsupportedMediaTypeError

MAX_ENTRIES = 2_000
# Parsed XML trees cost several times the XML size in memory, per concurrent extraction slot.
MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
MAX_RATIO = 100
RATIO_CHECK_MIN_BYTES = 1024 * 1024

OoxmlKind = Literal["xlsx", "docx"]
_MAIN_PARTS: dict[str, OoxmlKind] = {"xl/workbook.xml": "xlsx", "word/document.xml": "docx"}


def open_package(data: bytes) -> zipfile.ZipFile:
    try:
        package = zipfile.ZipFile(BytesIO(data))
        entries = package.infolist()
    except (zipfile.BadZipFile, zipfile.LargeZipFile, OSError, ValueError) as exc:
        raise UnsupportedMediaTypeError("not a readable zip container") from exc
    if len(entries) > MAX_ENTRIES:
        raise DocumentParseError("package has too many entries")
    total = 0
    for entry in entries:
        total += entry.file_size
        if entry.file_size > RATIO_CHECK_MIN_BYTES and entry.file_size > MAX_RATIO * max(
            entry.compress_size, 1
        ):
            raise DocumentParseError("package entry is compressed suspiciously well")
    if total > MAX_UNCOMPRESSED_BYTES:
        raise DocumentParseError("package is too large when uncompressed")
    return package


def package_kind(package: zipfile.ZipFile) -> OoxmlKind | None:
    names = set(package.namelist())
    for part, kind in _MAIN_PARTS.items():
        if part in names:
            return kind
    return None
