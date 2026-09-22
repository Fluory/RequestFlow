from __future__ import annotations

from email.message import EmailMessage
from email.policy import SMTP
from pathlib import Path

import pytest

from requestflow_ai.parsing.eml import parse_eml
from requestflow_ai.parsing.errors import DocumentParseError
from requestflow_ai.parsing.segments import EmailLocator


def test_eml_body_lines_become_segments_with_line_locators(fixtures_dir: Path) -> None:
    segments = parse_eml((fixtures_dir / "anfrage_musterbau.eml").read_bytes())
    by_id = {s.id: s for s in segments}

    company = by_id["eml-l9"]
    assert company.text == "Musterbau Beispiel GmbH"
    assert company.locator == EmailLocator(part="body", line=9)

    # Quoted-printable and UTF-8 are decoded.
    assert by_id["eml-l4"].text == "Gew\u00fcnschter Liefertermin: 15.11.2026"
    # Empty lines keep their number but produce no segment.
    assert "eml-l2" not in by_id


def test_eml_from_and_subject_headers_are_segments(fixtures_dir: Path) -> None:
    segments = parse_eml((fixtures_dir / "anfrage_musterbau.eml").read_bytes())
    headers = [s for s in segments if isinstance(s.locator, EmailLocator)]
    header_segments = [s for s in headers if s.locator.part == "header"]
    assert [s.id for s in header_segments] == ["eml-h-from", "eml-h-subject"]
    assert header_segments[0].text == "From: Erika Mustermann <erika.mustermann@example.com>"
    # RFC 2047 encoded-word is decoded (en dash).
    assert header_segments[1].text == "Subject: Anfrage Flansche \u2013 Musterbau Beispiel GmbH"


def test_eml_attachment_payload_is_not_a_segment(fixtures_dir: Path) -> None:
    segments = parse_eml((fixtures_dir / "anfrage_musterbau.eml").read_bytes())
    assert not any("JVBERi0" in s.text for s in segments)


def test_eml_segment_ids_are_stable_across_parses(fixtures_dir: Path) -> None:
    data = (fixtures_dir / "anfrage_musterbau.eml").read_bytes()
    assert parse_eml(data) == parse_eml(data)


def test_eml_crlf_and_lf_give_the_same_segments(fixtures_dir: Path) -> None:
    data = (fixtures_dir / "anfrage_musterbau.eml").read_bytes().replace(b"\r\n", b"\n")
    crlf = data.replace(b"\n", b"\r\n")
    assert parse_eml(data) == parse_eml(crlf)


def test_html_only_mail_is_converted_to_text_lines() -> None:
    message = EmailMessage()
    message["From"] = "Einkauf <einkauf@example.com>"
    message["Subject"] = "Anfrage"
    message.set_content(
        "<html><body><p>Hallo,</p><p>Firma: <b>Musterbau Beispiel GmbH</b></p>"
        "<script>alert(1)</script><div>Liefertermin 1.12.26</div></body></html>",
        subtype="html",
    )
    segments = parse_eml(message.as_bytes(policy=SMTP))
    body = [
        s.text for s in segments if isinstance(s.locator, EmailLocator) and s.locator.part == "body"
    ]
    assert body == ["Hallo,", "Firma: Musterbau Beispiel GmbH", "Liefertermin 1.12.26"]


def test_plain_part_is_preferred_over_html() -> None:
    message = EmailMessage()
    message["From"] = "a@example.com"
    message.set_content("Klartext Zeile")
    message.add_alternative("<p>HTML Zeile</p>", subtype="html")
    segments = parse_eml(message.as_bytes(policy=SMTP))
    assert [s.text for s in segments if s.id.startswith("eml-l")] == ["Klartext Zeile"]


def test_header_injection_via_newline_is_collapsed() -> None:
    raw = (
        b"From: a@example.com\r\n"
        b"Subject: =?utf-8?q?Hallo=0AFrom=3A_boss=40example=2Ecom?=\r\n"
        b"\r\nBody\r\n"
    )
    segments = parse_eml(raw)
    subject = next(s for s in segments if s.id == "eml-h-subject")
    assert "\n" not in subject.text


def test_mail_without_body_text_yields_only_headers() -> None:
    raw = b"From: a@example.com\r\nSubject: leer\r\nContent-Type: text/plain\r\n\r\n\r\n"
    segments = parse_eml(raw)
    assert [s.id for s in segments] == ["eml-h-from", "eml-h-subject"]


def test_garbage_bytes_raise_parse_error() -> None:
    with pytest.raises(DocumentParseError):
        parse_eml(b"\x00\x01\x02 not a mail")
