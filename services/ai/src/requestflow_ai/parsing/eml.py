"""EML parsing with the Python standard library (``email``, ``policy=default``).

Why not docling: docling 2.130 has an EMAIL backend (``.eml`` and ``.msg`` via mail-parser and
python-oxmsg), but it emits body *paragraphs* without provenance, so it cannot give the body-line
locators this service needs. The standard library gives the decoded body text, which is split into
lines here (ADR-0001 D8: "the fallback for EML is the Python standard library email package").

Segments: ``From`` and ``Subject`` headers (``eml-h-from``, ``eml-h-subject``) and one segment per
non-empty line of the preferred text body (``eml-l{line}``, 1-based, empty lines count).
Attachments are not parsed here; the caller sends each attachment as its own document.
"""

from __future__ import annotations

import logging
import re
from email import policy
from email.message import EmailMessage, Message
from email.parser import BytesParser
from html.parser import HTMLParser

from requestflow_ai.parsing.errors import DocumentParseError
from requestflow_ai.parsing.segments import EmailLocator, Segment

_log = logging.getLogger(__name__)
_HEADERS = (("From", "eml-h-from"), ("Subject", "eml-h-subject"))
_LINE_BREAK = re.compile(r"\r\n|\r|\n")
_BLOCK_TAGS = {
    "address", "article", "blockquote", "br", "dd", "div", "dl", "dt", "footer", "h1", "h2",
    "h3", "h4", "h5", "h6", "header", "hr", "li", "ol", "p", "pre", "section", "table", "td",
    "th", "tr", "ul",
}  # fmt: skip
_SKIP_TAGS = {"script", "style", "head", "title"}


class _HtmlText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)


def _html_to_text(html: str) -> str:
    parser = _HtmlText()
    parser.feed(html)
    parser.close()
    lines = (" ".join(line.split()) for line in _LINE_BREAK.split("".join(parser.parts)))
    return "\n".join(line for line in lines if line)


def _single_line(value: str) -> str:
    # Decoded RFC 2047 words may contain line breaks; never let them fake extra lines.
    return " ".join(value.split())


def _part_text(part: Message) -> str:
    try:
        content = part.get_content()  # type: ignore[attr-defined]
        if isinstance(content, str):
            return content
    except (LookupError, UnicodeError, KeyError):
        pass
    payload = part.get_payload(decode=True)
    return payload.decode("utf-8", errors="replace") if isinstance(payload, bytes) else ""


def _body_text(message: EmailMessage) -> str:
    body = message.get_body(preferencelist=("plain", "html"))
    if body is None:
        return ""
    text = _part_text(body)
    if body.get_content_subtype() == "html":
        return _html_to_text(text)
    return text


def parse_eml(data: bytes) -> list[Segment]:
    try:
        message = BytesParser(policy=policy.default).parsebytes(data)
    except Exception as exc:  # the parser is lenient; this is a last-resort guard
        raise DocumentParseError("could not parse e-mail") from exc
    if not isinstance(message, EmailMessage) or not message.keys():
        raise DocumentParseError("not an RFC 5322 message")

    segments: list[Segment] = []
    position = 0
    for name, segment_id in _HEADERS:
        try:
            raw = message.get(name)
        except Exception:  # malformed header value: skip the header, keep the body
            _log.warning("eml_header_unparseable", extra={"header": name})
            continue
        value = _single_line(str(raw)) if raw is not None else ""
        if value:
            position += 1
            segments.append(
                Segment(
                    id=segment_id,
                    text=f"{name}: {value}",
                    locator=EmailLocator(part="header", line=position, header=name),
                )
            )

    try:
        body = _body_text(message)
    except Exception as exc:
        raise DocumentParseError("could not decode e-mail body") from exc
    for number, line in enumerate(_LINE_BREAK.split(body), start=1):
        text = line.strip()
        if text:
            segments.append(
                Segment(
                    id=f"eml-l{number}", text=text, locator=EmailLocator(part="body", line=number)
                )
            )
    return segments
