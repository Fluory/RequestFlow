"""parse -> extract -> verify (ADR-0001 D8). Pure orchestration; no I/O besides the model call."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

from requestflow_ai.extraction.model_client import ModelClient, ModelUsage
from requestflow_ai.extraction.prompt import render_document, system_instruction
from requestflow_ai.extraction.schema import FIELD_KEYS, FieldKey
from requestflow_ai.grounding.verifier import VerifiedField, verify_extraction
from requestflow_ai.parsing.detect import DocumentKind, detect_kind
from requestflow_ai.parsing.eml import parse_eml
from requestflow_ai.parsing.pdf import PdfPipeline, parse_pdf
from requestflow_ai.parsing.segments import Segment

Warning = Literal["no_text"]


@dataclass(frozen=True)
class ExtractionRun:
    document_kind: DocumentKind
    segments: list[Segment]
    fields: dict[FieldKey, VerifiedField]
    model_id: str
    model_version: str | None
    usage: ModelUsage
    model_latency_ms: int | None
    warnings: list[Warning]


def parse_document(
    data: bytes, declared_type: str | None, pdf_pipeline: PdfPipeline
) -> tuple[DocumentKind, list[Segment]]:
    kind = detect_kind(data, declared_type)
    if kind == "pdf":
        return kind, parse_pdf(data, pdf_pipeline)
    return kind, parse_eml(data)


def run_extraction(
    data: bytes,
    declared_type: str | None,
    model: ModelClient,
    pdf_pipeline: PdfPipeline,
) -> ExtractionRun:
    kind, segments = parse_document(data, declared_type, pdf_pipeline)

    if not segments:
        # Nothing to cite, so nothing can be found; do not spend a model call on it.
        missing: dict[FieldKey, VerifiedField] = {
            key: VerifiedField(None, "missing", None, "missing") for key in FIELD_KEYS
        }
        return ExtractionRun(
            document_kind=kind,
            segments=[],
            fields=missing,
            model_id=model.model_id,
            model_version=None,
            usage=ModelUsage(None, None, None),
            model_latency_ms=None,
            warnings=["no_text"],
        )

    started = time.perf_counter()
    response = model.extract(system_instruction(), render_document(segments))
    model_latency_ms = round((time.perf_counter() - started) * 1000)

    return ExtractionRun(
        document_kind=kind,
        segments=segments,
        fields=verify_extraction(response.extraction, segments),
        model_id=model.model_id,
        model_version=response.model_version,
        usage=response.usage,
        model_latency_ms=model_latency_ms,
        warnings=[],
    )
