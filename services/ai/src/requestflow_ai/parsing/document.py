"""Parse one uploaded document of any supported kind; Outlook attachments recursively.

``parse_document`` detects the kind from the bytes and dispatches to the PDF, EML, XLSX, DOCX or
MSG parser. A ``.msg`` attachment is parsed with the same dispatcher (``depth`` + 1); its
segments keep their own locator, wrapped in a ``MsgLocator(part="attachment")`` with the
attachment's index and name, and get the id prefix ``msg-a{index}-``.

Partial failure: an attachment that cannot be parsed (unsupported type, damaged, too long, too
deep, over the attachment cap, not stored by value, or an unexpected parser error) never fails
the message. It is reported in ``ParsedDocument.attachments`` with an error code and contributes
no segments; the body and the other attachments are processed. Only the top-level document
raises (-> 415/422 as before).

EML attachments are not parsed here: the TS worker splits an ``.eml`` and sends every attachment
as its own document (unchanged). Only ``.msg``, which the worker cannot split, is unpacked here.

Limits: ``MAX_ATTACHMENT_DEPTH`` nesting levels, ``MAX_ATTACHMENTS`` per message (attachments
beyond it are never decoded), ``MAX_SEGMENTS`` for the whole document (an attachment that would
exceed it is reported as ``document_too_long``) and one ``ParseBudget`` per uploaded document
(attachments, unzipped bytes, PDF pages, OCR pages; an attachment that would overdraw it is
reported as ``budget_exceeded``, see ``parsing.budget``). Logs carry error codes and exception
types only, never names or content.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace
from typing import Literal

from oxmsg import Message

from requestflow_ai.parsing.budget import ParseBudget
from requestflow_ai.parsing.detect import DocumentKind, detect_kind
from requestflow_ai.parsing.docx import parse_docx
from requestflow_ai.parsing.eml import parse_eml
from requestflow_ai.parsing.errors import (
    BudgetExceededError,
    DocumentParseError,
    DocumentTooLongError,
    UnsupportedMediaTypeError,
)
from requestflow_ai.parsing.msg import (
    RawAttachment,
    load_message,
    message_attachments,
    message_segments,
)
from requestflow_ai.parsing.pdf import DEFAULT_MAX_PAGES, PdfOcr, PdfPipeline, parse_pdf_document
from requestflow_ai.parsing.segments import AttachmentRef, MsgLocator, Segment
from requestflow_ai.parsing.xlsx import parse_xlsx

_log = logging.getLogger(__name__)

MAX_ATTACHMENT_DEPTH = 3
MAX_ATTACHMENTS = 50
MAX_SEGMENTS = 20_000

AttachmentStatus = Literal["parsed", "failed"]
AttachmentError = Literal[
    "unsupported_media_type",
    "document_unparseable",
    "document_too_long",
    "nesting_too_deep",
    "too_many_attachments",
    "not_attached_by_value",
    "budget_exceeded",
]


@dataclass(frozen=True)
class ParseOptions:
    pdf_pipeline: PdfPipeline = "textlines"
    max_pdf_pages: int = DEFAULT_MAX_PAGES
    pdf_ocr: PdfOcr = "off"
    # One per uploaded document, created by the top-level ``parse_document`` (mutable, shared).
    budget: ParseBudget | None = field(default=None, compare=False)


@dataclass(frozen=True)
class AttachmentReport:
    path: tuple[int, ...]  # attachment index per nesting level, outermost first
    name: str | None
    kind: DocumentKind | None
    status: AttachmentStatus
    error: AttachmentError | None
    segment_count: int


@dataclass(frozen=True)
class ParsedDocument:
    kind: DocumentKind
    segments: list[Segment]
    attachments: list[AttachmentReport] = field(default_factory=list[AttachmentReport])
    pdf_parsed: bool = False  # a PDF was parsed (the document itself or an attachment)
    ocr_pages_skipped: int = 0  # pages without text not OCR'd because of the OCR page cap


def parse_document(
    data: bytes, declared_type: str | None, options: ParseOptions, depth: int = 0
) -> ParsedDocument:
    budget = options.budget
    if budget is None:
        budget = ParseBudget.for_document(options.max_pdf_pages)
        options = replace(options, budget=budget)
    kind = detect_kind(data, declared_type)
    if kind == "pdf":
        pdf = parse_pdf_document(
            data,
            options.pdf_pipeline,
            options.max_pdf_pages,
            options.pdf_ocr,
            max_ocr_pages=budget.ocr_pages,
            page_budget=budget.pdf_pages,
        )
        budget.take_pdf_pages(pdf.page_count)
        budget.take_ocr_pages(pdf.ocr_pages)
        return ParsedDocument(
            kind, pdf.segments, pdf_parsed=True, ocr_pages_skipped=pdf.ocr_pages_skipped
        )
    if kind == "xlsx":
        return ParsedDocument(kind, parse_xlsx(data, budget))
    if kind == "docx":
        return ParsedDocument(kind, parse_docx(data, budget))
    if kind == "msg":
        return _parse_message(load_message(data), options, depth)
    return ParsedDocument(kind, parse_eml(data))


def _error_code(exc: Exception) -> AttachmentError:
    if isinstance(exc, UnsupportedMediaTypeError):
        return "unsupported_media_type"
    if isinstance(exc, BudgetExceededError):
        return "budget_exceeded"
    if isinstance(exc, DocumentTooLongError):
        return "document_too_long"
    return "document_unparseable"


def _wrap(segment: Segment, ref: AttachmentRef) -> Segment:
    return Segment(
        id=f"msg-a{ref.index}-{segment.id}",
        text=segment.text,
        locator=MsgLocator(part="attachment", attachment=ref, inner=segment.locator),
    )


def _parse_attachment(
    raw: RawAttachment, options: ParseOptions, depth: int
) -> ParsedDocument | AttachmentError:
    """Parse one attachment at nesting level ``depth``; an error code instead of raising."""
    if raw.over_cap or raw.index >= MAX_ATTACHMENTS:
        return "too_many_attachments"
    if depth > MAX_ATTACHMENT_DEPTH:
        return "nesting_too_deep"
    if raw.not_by_value:
        return "not_attached_by_value"
    try:
        if options.budget is not None:
            options.budget.take_attachment()
        if raw.embedded is not None:
            return _parse_message(raw.embedded, options, depth)
        if raw.data is None:
            return "document_unparseable"
        return parse_document(raw.data, raw.mime_type, options, depth)
    except UnsupportedMediaTypeError:
        return "unsupported_media_type"
    except BudgetExceededError:
        return "budget_exceeded"
    except DocumentTooLongError:
        return "document_too_long"
    except DocumentParseError:
        return "document_unparseable"
    except Exception as exc:  # a parser bug must not fail the whole message
        _log.warning("attachment_parser_error", extra={"errorType": type(exc).__name__})
        return "document_unparseable"


def _parse_message(message: Message, options: ParseOptions, depth: int) -> ParsedDocument:
    segments = message_segments(message)
    reports: list[AttachmentReport] = []
    pdf_parsed = False
    ocr_pages_skipped = 0

    for raw in message_attachments(message, MAX_ATTACHMENTS):
        path = (raw.index,)
        child = _parse_attachment(raw, options, depth + 1)
        if not isinstance(child, str) and len(segments) + len(child.segments) > MAX_SEGMENTS:
            child = "document_too_long"
        if isinstance(child, str):
            _log.warning("attachment_failed", extra={"errorCode": child, "depth": depth + 1})
            reports.append(AttachmentReport(path, raw.name, None, "failed", child, 0))
            continue

        ref = AttachmentRef(index=raw.index, name=raw.name)
        segments.extend(_wrap(segment, ref) for segment in child.segments)
        pdf_parsed = pdf_parsed or child.pdf_parsed
        ocr_pages_skipped += child.ocr_pages_skipped
        reports.append(
            AttachmentReport(path, raw.name, child.kind, "parsed", None, len(child.segments))
        )
        reports.extend(
            AttachmentReport(
                path + nested.path,
                nested.name,
                nested.kind,
                nested.status,
                nested.error,
                nested.segment_count,
            )
            for nested in child.attachments
        )
    return ParsedDocument("msg", segments, reports, pdf_parsed, ocr_pages_skipped)
