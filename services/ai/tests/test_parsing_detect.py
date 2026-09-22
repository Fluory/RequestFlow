from __future__ import annotations

from pathlib import Path

import pytest

from requestflow_ai.parsing.detect import detect_kind
from requestflow_ai.parsing.errors import UnsupportedMediaTypeError

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def test_pdf_is_detected_by_magic_bytes(fixtures_dir: Path) -> None:
    data = (fixtures_dir / "anfrage_musterbau.pdf").read_bytes()
    assert detect_kind(data, declared=None) == "pdf"
    # The declared type does not override the bytes.
    assert detect_kind(data, declared="message/rfc822") == "pdf"


def test_eml_is_detected_by_declared_type_or_header_shape(fixtures_dir: Path) -> None:
    data = (fixtures_dir / "anfrage_musterbau.eml").read_bytes()
    assert detect_kind(data, declared="message/rfc822") == "eml"
    assert detect_kind(data, declared=None) == "eml"


def test_outlook_msg_is_rejected_for_now() -> None:
    with pytest.raises(UnsupportedMediaTypeError):
        detect_kind(OLE_MAGIC + b"\x00" * 64, declared="application/vnd.ms-outlook")


@pytest.mark.parametrize("data", [b"PK\x03\x04docx-ish", b"\x89PNG\r\n\x1a\n", b"just text"])
def test_other_bytes_are_unsupported(data: bytes) -> None:
    with pytest.raises(UnsupportedMediaTypeError):
        detect_kind(data, declared=None)
