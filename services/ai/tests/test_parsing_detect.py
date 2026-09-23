from __future__ import annotations

from pathlib import Path

import pytest
from builders import MsgSpec, build_cfb, build_docx, build_msg, build_xlsx

from requestflow_ai.parsing.detect import detect_kind
from requestflow_ai.parsing.errors import DocumentParseError, UnsupportedMediaTypeError

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


def test_office_and_outlook_formats_are_detected_by_content() -> None:
    # The declared type never overrides the bytes.
    assert detect_kind(build_xlsx({"S": [["a"]]}), declared="application/pdf") == "xlsx"
    assert detect_kind(build_docx(["a"]), declared=None) == "docx"
    assert detect_kind(build_msg(MsgSpec(subject="s", body="b")), declared=None) == "msg"


def test_other_ole_files_are_unsupported() -> None:
    # Legacy .doc/.xls and password-protected OOXML are OLE files without MSG property streams.
    with pytest.raises(UnsupportedMediaTypeError):
        detect_kind(build_cfb({"WordDocument": b"\x00" * 16}), declared=None)
    with pytest.raises(UnsupportedMediaTypeError):
        detect_kind(build_cfb({"EncryptionInfo": b"\x00" * 16}), declared=None)


def test_broken_ole_container_is_a_parse_error() -> None:
    # Adapted (#23): .msg is supported now; this used to assert "rejected for now" (415).
    with pytest.raises(DocumentParseError):
        detect_kind(OLE_MAGIC + b"\x00" * 64, declared="application/vnd.ms-outlook")


@pytest.mark.parametrize("data", [b"PK\x03\x04docx-ish", b"\x89PNG\r\n\x1a\n", b"just text"])
def test_other_bytes_are_unsupported(data: bytes) -> None:
    with pytest.raises(UnsupportedMediaTypeError):
        detect_kind(data, declared=None)
