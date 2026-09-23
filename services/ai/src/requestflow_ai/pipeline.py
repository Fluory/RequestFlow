"""parse -> extract -> verify (ADR-0001 D8). Pure orchestration; no I/O besides the model call."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

from requestflow_ai.extraction.model_client import ModelClient, ModelUsage
from requestflow_ai.extraction.prompt import render_document, system_instruction
from requestflow_ai.extraction.schema import FIELD_KEYS, FieldKey
from requestflow_ai.grounding.verifier import (
    VerifiedField,
    VerifiedLineItem,
    verify_extraction,
    verify_line_items,
)
from requestflow_ai.parsing.detect import DocumentKind
from requestflow_ai.parsing.document import AttachmentReport, ParseOptions, parse_document
from requestflow_ai.parsing.pdf import DEFAULT_MAX_PAGES, PdfOcr, PdfPipeline
from requestflow_ai.parsing.segments import Segment

Warning = Literal["no_text", "attachment_failed", "ocr_pages_skipped"]


@dataclass(frozen=True)
class ExtractionRun:
    document_kind: DocumentKind
    segments: list[Segment]
    fields: dict[FieldKey, VerifiedField]
    line_items: list[VerifiedLineItem]
    model_id: str
    model_version: str | None
    usage: ModelUsage
    model_latency_ms: int | None
    warnings: list[Warning]
    attachments: list[AttachmentReport]
    pdf_parsed: bool  # a PDF was parsed (the document or one of its attachments)


def run_extraction(
    data: bytes,
    declared_type: str | None,
    model: ModelClient,
    pdf_pipeline: PdfPipeline,
    max_pdf_pages: int = DEFAULT_MAX_PAGES,
    pdf_ocr: PdfOcr = "off",
) -> ExtractionRun:
    parsed = parse_document(
        data,
        declared_type,
        ParseOptions(pdf_pipeline=pdf_pipeline, max_pdf_pages=max_pdf_pages, pdf_ocr=pdf_ocr),
    )
    kind, segments = parsed.kind, parsed.segments
    warnings: list[Warning] = []
    if not segments:
        warnings.append("no_text")
    if any(report.status == "failed" for report in parsed.attachments):
        warnings.append("attachment_failed")
    if parsed.ocr_pages_skipped:
        warnings.append("ocr_pages_skipped")

    if not segments:
        # Nothing to cite, so nothing can be found; do not spend a model call on it.
        missing: dict[FieldKey, VerifiedField] = {
            key: VerifiedField(None, "missing", None, "missing") for key in FIELD_KEYS
        }
        return ExtractionRun(
            document_kind=kind,
            segments=[],
            fields=missing,
            line_items=[],
            model_id=model.model_id,
            model_version=None,
            usage=ModelUsage(None, None, None),
            model_latency_ms=None,
            warnings=warnings,
            attachments=parsed.attachments,
            pdf_parsed=parsed.pdf_parsed,
        )

    started = time.perf_counter()
    response = model.extract(system_instruction(), render_document(segments))
    model_latency_ms = round((time.perf_counter() - started) * 1000)

    return ExtractionRun(
        document_kind=kind,
        segments=segments,
        fields=verify_extraction(response.extraction, segments),
        line_items=verify_line_items(response.extraction, segments),
        model_id=model.model_id,
        model_version=response.model_version,
        usage=response.usage,
        model_latency_ms=model_latency_ms,
        warnings=warnings,
        attachments=parsed.attachments,
        pdf_parsed=parsed.pdf_parsed,
    )
