"""Outlook ``.msg`` reading with python-oxmsg (MIT; on top of olefile, BSD).

This module reads one message: its ``From``/``Subject`` headers and body lines (segments like EML,
ids ``msg-h-from``, ``msg-h-subject``, ``msg-l{line}``) and the raw attachments. Parsing the
attachments (recursively, with the same parsers) is ``parsing.document``'s job.

Why not docling: its EMAIL backend reads ``.msg`` through python-oxmsg too, but emits body
paragraphs without line provenance and only the *names* of attachments. ``extract-msg`` is
GPL-3.0 and therefore not used.

Body: the plain-text body (``PidTagBody``); without one, the HTML body reduced to text lines like
EML. A message with only an RTF body (``PidTagRtfCompressed``) yields no body segments
(documented limitation). Attachments: stored by value (``ATTACH_BY_VALUE``) -> their bytes;
an attached Outlook item (``ATTACH_EMBEDDED_MSG``, a sub-storage) -> an embedded message;
anything else (by reference, OLE objects) is reported as ``not_attached_by_value``.

All streams are read into memory by olefile; the upload limit (``AI_MAX_DOCUMENT_BYTES``) bounds
that. Errors never carry document content.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Any

from oxmsg import Message
from oxmsg.domain import model as oxmsg_model
from oxmsg.properties import Properties
from oxmsg.util import lazyproperty

from requestflow_ai.parsing.eml import LINE_BREAK, html_to_text
from requestflow_ai.parsing.errors import DocumentParseError
from requestflow_ai.parsing.segments import MsgLocator, Segment

_PID_ATTACH_METHOD = 0x3705
_PID_ATTACH_FILENAME = 0x3704
_PID_DISPLAY_NAME = 0x3001
_ATTACH_BY_VALUE = 1
_ATTACH_EMBEDDED_MSG = 5
_EMBEDDED_STORAGE = "__substg1.0_3701000D"
_EMBEDDED_HEADER_OFFSET = 24  # [MS-OXMSG] 2.4.1.2: embedded message property stream header
MAX_NAME_LENGTH = 255


class _EmbeddedMessage(Message):
    """An attached Outlook item: same layout as a message, but a 24-byte properties header."""

    @lazyproperty
    def _properties(self) -> Properties:
        return Properties(self._storage, properties_header_offset=_EMBEDDED_HEADER_OFFSET)


@dataclass(frozen=True)
class RawAttachment:
    index: int
    name: str | None
    mime_type: str | None
    data: bytes | None = None
    embedded: Message | None = None
    not_by_value: bool = False


def load_message(data: bytes) -> Message:
    try:
        message = Message.load(BytesIO(data))  # a stream: olefile reads short bytes as a path
        _ = message.attachment_count  # validates the root properties header
    except Exception as exc:
        raise DocumentParseError("could not read Outlook message") from exc
    return message


def _single_line(value: str | None, limit: int | None = None) -> str:
    text = " ".join((value or "").split())
    return text[:limit] if limit is not None else text


def message_segments(message: Message) -> list[Segment]:
    try:
        headers = (
            ("From", "msg-h-from", message.sender),
            ("Subject", "msg-h-subject", message.subject),
        )
        body = message.body
        if not body:
            html = message.html_body
            body = html_to_text(html) if html else ""
    except Exception as exc:
        raise DocumentParseError("could not decode Outlook message") from exc

    segments: list[Segment] = []
    position = 0
    for name, segment_id, raw in headers:
        value = _single_line(raw)
        if value:
            position += 1
            segments.append(
                Segment(
                    id=segment_id,
                    text=f"{name}: {value}",
                    locator=MsgLocator(part="header", line=position, header=name),
                )
            )
    for number, line in enumerate(LINE_BREAK.split(body), start=1):
        text = line.strip()
        if text:
            segments.append(
                Segment(
                    id=f"msg-l{number}", text=text, locator=MsgLocator(part="body", line=number)
                )
            )
    return segments


def _embedded(attachment: Any) -> Message | None:
    storage: oxmsg_model.StorageT = attachment._storage  # oxmsg has no public accessor
    for child in getattr(storage, "storages", ()):
        if child.name == _EMBEDDED_STORAGE:
            return _EmbeddedMessage(child)
    return None


def message_attachments(message: Message) -> list[RawAttachment]:
    try:
        attachments = message.attachments
    except Exception as exc:
        raise DocumentParseError("could not read Outlook attachments") from exc
    result: list[RawAttachment] = []
    for index, attachment in enumerate(attachments):
        try:
            props = attachment.properties
            name = (
                attachment.file_name
                or props.str_prop_value(_PID_ATTACH_FILENAME)
                or props.str_prop_value(_PID_DISPLAY_NAME)
            )
            name = _single_line(name, MAX_NAME_LENGTH) or None
            method = props.int_prop_value(_PID_ATTACH_METHOD)
            mime_type = _single_line(attachment.mime_type, 100) or None
            if method == _ATTACH_BY_VALUE:
                result.append(RawAttachment(index, name, mime_type, data=attachment.file_bytes))
            elif method == _ATTACH_EMBEDDED_MSG and (inner := _embedded(attachment)) is not None:
                result.append(RawAttachment(index, name, None, embedded=inner))
            else:
                result.append(RawAttachment(index, name, mime_type, not_by_value=True))
        except Exception:
            # A damaged attachment table entry: report it, keep the rest of the message.
            result.append(RawAttachment(index, None, None))
    return result
