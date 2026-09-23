"""Outlook .msg: headers and body lines, attachments parsed recursively with the same parsers."""

from __future__ import annotations

import struct
import time
from pathlib import Path
from typing import Any

import pytest
from builders import DocxTable, MsgAttachment, MsgSpec, build_docx, build_msg, build_xlsx

from oxmsg.attachment import Attachment

from requestflow_ai.parsing import document as document_module
from requestflow_ai.parsing.detect import detect_kind
from requestflow_ai.parsing.document import ParseOptions, parse_document
from requestflow_ai.parsing.errors import DocumentParseError
from requestflow_ai.parsing.msg import load_message
from requestflow_ai.parsing.segments import (
    AttachmentRef,
    DocxLocator,
    MsgLocator,
    PdfLocator,
    XlsxLocator,
)

OPTIONS = ParseOptions(pdf_pipeline="textlines")
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

BODY = "Guten Tag,\n\nbitte um Angebot fuer 1.250 Stueck Flansch DN50.\nLiefertermin: 15.11.2026\n"


def _spec(attachments: list[MsgAttachment]) -> MsgSpec:
    return MsgSpec(
        subject="Anfrage 2026-0815",
        sender_name="Erika Mustermann",
        sender_email="erika.mustermann@example.com",
        body=BODY,
        attachments=attachments,
    )


def test_headers_and_body_lines_have_msg_locators() -> None:
    parsed = parse_document(build_msg(_spec([])), None, OPTIONS)
    assert parsed.kind == "msg"
    by_id = {s.id: s for s in parsed.segments}
    assert by_id["msg-h-from"].text == 'From: "Erika Mustermann" <erika.mustermann@example.com>'
    assert by_id["msg-h-from"].locator == MsgLocator(part="header", line=1, header="From")
    assert by_id["msg-h-subject"].text == "Subject: Anfrage 2026-0815"
    # Body lines are numbered like EML: 1-based, empty lines count and produce no segment.
    assert by_id["msg-l3"].text == "bitte um Angebot fuer 1.250 Stueck Flansch DN50."
    assert by_id["msg-l3"].locator == MsgLocator(part="body", line=3)
    assert "msg-l2" not in by_id
    assert parsed.attachments == []


def test_html_only_body_is_reduced_to_text_lines() -> None:
    spec = MsgSpec(subject="S", html_body="<html><body><p>Zeile eins</p><p>Zeile zwei</p></body>")
    parsed = parse_document(build_msg(spec), None, OPTIONS)
    body = [s.text for s in parsed.segments if s.id.startswith("msg-l")]
    assert body == ["Zeile eins", "Zeile zwei"]


def test_attachments_are_parsed_with_their_own_locator_wrapped(fixtures_dir: Path) -> None:
    pdf = (fixtures_dir / "anfrage_musterbau.pdf").read_bytes()
    xlsx = build_xlsx({"Positionen": [["Flansch DN50", 1250, "Stk."]]})
    docx = build_docx(["Liefertermin: 15.11.2026", DocxTable(rows=[["Werkstoff", "1.4301"]])])
    spec = _spec(
        [
            MsgAttachment("anfrage.pdf", pdf, "application/pdf"),
            MsgAttachment("positionen.xlsx", xlsx, XLSX_TYPE),
            MsgAttachment("details.docx", docx),
        ]
    )
    parsed = parse_document(build_msg(spec), None, OPTIONS)
    by_id = {s.id: s for s in parsed.segments}

    first = by_id["msg-a0-p1-l1"]
    assert first.text == "Musterbau Beispiel GmbH"
    assert isinstance(first.locator, MsgLocator)
    assert first.locator.part == "attachment"
    assert first.locator.attachment == AttachmentRef(index=0, name="anfrage.pdf")
    assert isinstance(first.locator.inner, PdfLocator)
    assert first.locator.inner.page == 1

    row = by_id["msg-a1-s1-r1"]
    assert row.text == "Flansch DN50 | 1250 | Stk."
    assert isinstance(row.locator, MsgLocator)
    assert row.locator.inner == XlsxLocator(sheet="Positionen", row=1, cell_range="A1:C1")

    cell = by_id["msg-a2-d-t1-r1-c2"]
    assert isinstance(cell.locator, MsgLocator)
    assert cell.locator.inner == DocxLocator(part="table_cell", table=1, row=1, cell=2)

    assert [(a.path, a.name, a.kind, a.status, a.error) for a in parsed.attachments] == [
        ((0,), "anfrage.pdf", "pdf", "parsed", None),
        ((1,), "positionen.xlsx", "xlsx", "parsed", None),
        ((2,), "details.docx", "docx", "parsed", None),
    ]
    assert parsed.attachments[0].segment_count == 8
    assert parsed.pdf_parsed


def test_a_failing_attachment_does_not_fail_the_message(fixtures_dir: Path) -> None:
    good = build_xlsx({"S": [["Flansch DN50", 1250]]})
    spec = _spec(
        [
            MsgAttachment("kaputt.pdf", b"%PDF-1.4\n% truncated synthetic garbage\n"),
            MsgAttachment("bild.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, "image/png"),
            MsgAttachment("positionen.xlsx", good, XLSX_TYPE),
        ]
    )
    parsed = parse_document(build_msg(spec), None, OPTIONS)
    assert [(a.path, a.status, a.error, a.segment_count) for a in parsed.attachments] == [
        ((0,), "failed", "document_unparseable", 0),
        ((1,), "failed", "unsupported_media_type", 0),
        ((2,), "parsed", None, 1),
    ]
    ids = [s.id for s in parsed.segments]
    assert "msg-a2-s1-r1" in ids
    assert not any(i.startswith(("msg-a0-", "msg-a1-")) for i in ids)
    assert "msg-l3" in ids  # the body is still there


def test_unexpected_parser_crash_in_an_attachment_is_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def crash(_: bytes) -> object:
        raise RuntimeError("synthetic parser bug")

    monkeypatch.setattr(document_module, "parse_xlsx", crash)
    spec = _spec([MsgAttachment("a.xlsx", build_xlsx({"S": [["x"]]}), XLSX_TYPE)])
    parsed = parse_document(build_msg(spec), None, OPTIONS)
    (report,) = parsed.attachments
    assert (report.status, report.error) == ("failed", "document_unparseable")


def test_embedded_outlook_item_is_parsed_recursively() -> None:
    xlsx = build_xlsx({"S": [["Dichtung", 40]]})
    spec = _spec(
        [
            MsgAttachment(
                "Weitergeleitet",
                embedded=MsgSpec(
                    subject="Weitergeleitet",
                    body="Menge: 40 Stueck\n",
                    attachments=[MsgAttachment("pos.xlsx", xlsx, XLSX_TYPE)],
                ),
            )
        ]
    )
    parsed = parse_document(build_msg(spec), None, OPTIONS)
    by_id = {s.id: s for s in parsed.segments}

    line = by_id["msg-a0-msg-l1"]
    assert line.text == "Menge: 40 Stueck"
    assert isinstance(line.locator, MsgLocator)
    assert line.locator.inner == MsgLocator(part="body", line=1)

    nested = by_id["msg-a0-msg-a0-s1-r1"]
    assert isinstance(nested.locator, MsgLocator)
    assert isinstance(nested.locator.inner, MsgLocator)
    assert nested.locator.inner.attachment == AttachmentRef(index=0, name="pos.xlsx")
    assert [(a.path, a.kind, a.status) for a in parsed.attachments] == [
        ((0,), "msg", "parsed"),
        ((0, 0), "xlsx", "parsed"),
    ]


def test_nesting_depth_is_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(document_module, "MAX_ATTACHMENT_DEPTH", 1)
    xlsx = build_xlsx({"S": [["x"]]})
    spec = _spec(
        [
            MsgAttachment(
                "fwd",
                embedded=MsgSpec(body="innen\n", attachments=[MsgAttachment("a.xlsx", xlsx)]),
            )
        ]
    )
    parsed = parse_document(build_msg(spec), None, OPTIONS)
    assert [(a.path, a.status, a.error) for a in parsed.attachments] == [
        ((0,), "parsed", None),
        ((0, 0), "failed", "nesting_too_deep"),
    ]


def test_attachment_count_is_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(document_module, "MAX_ATTACHMENTS", 1)
    xlsx = build_xlsx({"S": [["x"]]})
    spec = _spec([MsgAttachment("a.xlsx", xlsx), MsgAttachment("b.xlsx", xlsx)])
    parsed = parse_document(build_msg(spec), None, OPTIONS)
    assert [(a.status, a.error) for a in parsed.attachments] == [
        ("parsed", None),
        ("failed", "too_many_attachments"),
    ]


def test_attachment_names_are_single_line_and_bounded() -> None:
    xlsx = build_xlsx({"S": [["x"]]})
    spec = _spec([MsgAttachment("a\r\nb" + "x" * 300 + ".xlsx", xlsx)])
    (report,) = parse_document(build_msg(spec), None, OPTIONS).attachments
    assert report.name is not None
    assert "\n" not in report.name
    assert len(report.name) <= 255


def test_ole_file_that_is_not_a_message_is_a_parse_error() -> None:
    from builders import build_cfb

    with pytest.raises(DocumentParseError):
        parse_document(build_cfb({"__properties_version1.0": b"\x00" * 4}), None, OPTIONS)


# --- OLE stream bombs (security review of #40) ------------------------------------------------

_FREE, _END, _FATSECT = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD


def _dirent(name: str, kind: int, child: int, start: int, size: int) -> bytes:
    encoded = (name + "\0").encode("utf-16-le")
    entry = encoded.ljust(64, b"\0") + struct.pack("<HBB", len(encoded), kind, 1)
    entry += struct.pack("<III", _FREE, _FREE, child) + b"\0" * 36
    entry += struct.pack("<III", start, size, 0)
    assert len(entry) == 128
    return entry


def _looped_ole(stream_size: int, root_size: int = 0) -> bytes:
    """A 2 KiB compound file whose one stream declares ``stream_size`` bytes on a FAT loop.

    Sector 0 is the FAT, 1 the directory, 2 the stream's data; ``fat[2] = 2`` points the stream at
    itself, so a reader that trusts the declared size reads sector 2 over and over.
    """
    header = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 16
    header += struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6) + b"\0" * 6
    # directory sectors, FAT sectors, first directory sector, transaction, mini cutoff,
    # first mini FAT sector, mini FAT sectors, first DIFAT sector, DIFAT sectors
    header += struct.pack("<IIIIIIIII", 0, 1, 1, 0, 4096, _END, 0, _END, 0)
    header += struct.pack("<I", 0) + struct.pack("<I", _FREE) * 108
    fat = struct.pack("<III", _FATSECT, _END, 2) + struct.pack("<I", _FREE) * 125
    directory = _dirent("Root Entry", 5, 1, 2 if root_size else _END, root_size)
    directory += _dirent("__properties_version1.0", 2, _FREE, 2, stream_size)
    return header + fat + directory.ljust(512, b"\0") + b"A" * 512


@pytest.mark.parametrize(
    ("stream_size", "root_size"),
    [
        (64 * 1024 * 1024, 0),  # declared stream far beyond the container, looped FAT
        (5_000, 0),  # small, but still larger than the whole 2 KiB file
        (100, 64 * 1024 * 1024),  # mini stream (root entry) declared far beyond the container
    ],
)
def test_ole_stream_larger_than_the_container_is_rejected_fast(
    stream_size: int, root_size: int
) -> None:
    data = _looped_ole(stream_size, root_size)
    assert len(data) == 2048
    started = time.perf_counter()
    with pytest.raises(DocumentParseError):
        detect_kind(data, None)
    with pytest.raises(DocumentParseError):
        load_message(data)
    with pytest.raises(DocumentParseError):
        parse_document(data, None, OPTIONS)
    assert time.perf_counter() - started < 2


def test_attachments_beyond_the_cap_are_never_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(document_module, "MAX_ATTACHMENTS", 1)
    xlsx = build_xlsx({"S": [["x"]]})
    spec = _spec([MsgAttachment("a.xlsx", xlsx), MsgAttachment("b.xlsx", xlsx)])
    read: list[int] = []
    original: Any = Attachment.__dict__["file_bytes"]  # oxmsg's lazyproperty

    def spy(self: Attachment) -> bytes | None:
        read.append(1)
        return original.__get__(self, Attachment)

    monkeypatch.setattr(Attachment, "file_bytes", property(spy))
    parsed = parse_document(build_msg(spec), None, OPTIONS)
    assert [(a.status, a.error) for a in parsed.attachments] == [
        ("parsed", None),
        ("failed", "too_many_attachments"),
    ]
    assert len(read) == 1
