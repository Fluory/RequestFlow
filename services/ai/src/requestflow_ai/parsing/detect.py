"""Detect the document kind from the bytes; a declared media type only helps for EML."""

from __future__ import annotations

import re
from typing import Literal

from requestflow_ai.parsing.errors import UnsupportedMediaTypeError

DocumentKind = Literal["pdf", "eml"]

_PDF_MAGIC = b"%PDF-"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # Outlook .msg (and legacy Office files)
_EML_TYPES = {"message/rfc822"}
# First line of an RFC 5322 message: a header field name followed by a colon.
_HEADER_LINE = re.compile(rb"^[!-9;-~]+:[ \t]")


def detect_kind(data: bytes, declared: str | None) -> DocumentKind:
    head = data[:1024]
    if head.lstrip()[:5] == _PDF_MAGIC:
        return "pdf"
    if head.startswith(_OLE_MAGIC):
        raise UnsupportedMediaTypeError("Outlook .msg is not supported yet")
    declared_type = (declared or "").split(";")[0].strip().lower()
    if declared_type in _EML_TYPES or _HEADER_LINE.match(head):
        return "eml"
    raise UnsupportedMediaTypeError("unsupported document type")
