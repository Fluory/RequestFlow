"""Detect the document kind from the bytes; a declared media type only helps for EML.

* ``%PDF-`` -> pdf.
* Zip (``PK\\x03\\x04``) with ``word/document.xml`` -> docx, with ``xl/workbook.xml`` -> xlsx
  (``.docm``/``.xlsm`` too; macros are never read). Zip limits apply (``ooxml.open_package``).
* OLE compound file with the MSG root property stream -> msg. Other OLE files (legacy
  ``.doc``/``.xls``, password-protected OOXML) are unsupported.
* RFC 5322 header shape or declared ``message/rfc822`` -> eml.
"""

from __future__ import annotations

import re
from typing import Literal

from requestflow_ai.parsing.errors import DocumentParseError, UnsupportedMediaTypeError
from requestflow_ai.parsing.msg import check_ole_container
from requestflow_ai.parsing.ooxml import open_package, package_kind

DocumentKind = Literal["pdf", "eml", "xlsx", "docx", "msg"]

_PDF_MAGIC = b"%PDF-"
_ZIP_MAGIC = b"PK\x03\x04"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # Outlook .msg (and legacy Office files)
_MSG_ROOT_STREAM = "__properties_version1.0"
_EML_TYPES = {"message/rfc822"}
# First line of an RFC 5322 message: a header field name followed by a colon.
_HEADER_LINE = re.compile(rb"^[!-9;-~]+:[ \t]")


def _is_msg(data: bytes) -> bool:
    # Stream sizes are bounded before anything is read (OLE stream bombs, see ``parsing.msg``).
    with check_ole_container(data) as ole:
        try:
            return bool(ole.exists(_MSG_ROOT_STREAM))
        except Exception as exc:
            raise DocumentParseError("could not read OLE container") from exc


def detect_kind(data: bytes, declared: str | None) -> DocumentKind:
    head = data[:1024]
    if head.lstrip()[:5] == _PDF_MAGIC:
        return "pdf"
    if head.startswith(_ZIP_MAGIC):
        with open_package(data) as package:
            kind = package_kind(package)
        if kind is None:
            raise UnsupportedMediaTypeError("zip container is not a DOCX or XLSX document")
        return kind
    if head.startswith(_OLE_MAGIC):
        if _is_msg(data):
            return "msg"
        raise UnsupportedMediaTypeError("OLE file is not an Outlook message")
    declared_type = (declared or "").split(";")[0].strip().lower()
    if declared_type in _EML_TYPES or _HEADER_LINE.match(head):
        return "eml"
    raise UnsupportedMediaTypeError("unsupported document type")
