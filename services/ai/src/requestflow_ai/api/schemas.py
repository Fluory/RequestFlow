"""API response models; the OpenAPI component schemas are generated from these names."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from requestflow_ai.extraction.schema import FIELD_KEYS, LINE_ITEM_KEYS, FieldKey, ModelStatus
from requestflow_ai.grounding.verifier import (
    FieldStatus,
    UnverifiedReason,
    VerifiedField,
    VerifiedLineItem,
)
from requestflow_ai.parsing.detect import DocumentKind
from requestflow_ai.parsing.document import AttachmentError, AttachmentReport
from requestflow_ai.parsing.segments import Segment

ErrorCode = Literal[
    "invalid_request",
    "unauthorized",
    "length_required",
    "document_too_large",
    "unsupported_media_type",
    "document_unparseable",
    "document_too_long",
    "busy",
    "model_error",
    "model_output_invalid",
    "internal_error",
]


class _Camel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        json_schema_serialization_defaults_required=True,
    )


class Evidence(_Camel):
    segment_id: str = Field(description="Id of a segment in `segments`.")
    quote: str = Field(description="Text the model copied from that segment.")


class FieldResult(_Camel):
    value: str | None = Field(
        description="Extracted value. For `found` and verified `uncertain` it is normalised: "
        "trimmed text; dates as YYYY-MM-DD (a calendar week without a date stays a week, see "
        "`reason` `calendar_week_only`); quantities as a plain decimal with a dot and no grouping "
        '("1250", "2.5"); units canonical (mm, cm, m, kg, t, pcs) or trimmed text for other '
        "units; e-mail lowercased; phone trimmed as written (no country code added). Kept as the "
        "model sent it for `unverified` (and for `uncertain` without evidence) so a human can "
        "review the proposal; null for `missing`."
    )
    status: FieldStatus = Field(
        description="Final status after verification. `found` only if the verifier confirmed the "
        "quote in the cited segment and the value against the quote."
    )
    evidence: Evidence | None
    model_status: ModelStatus = Field(description="What the model claimed before verification.")
    reason: UnverifiedReason | None = Field(
        default=None,
        description="Why the verifier set `unverified`; for `uncertain`: `ambiguous_quote` when "
        "it downgraded `found` (the quote holds several dates), `calendar_week_only` when a "
        "date field only has a calendar week (value then `KW <week>` or `KW <week>/<year>`, "
        "never a computed date) or `ocr_only` when the only evidence is OCR text (a segment "
        "with `locator.ocr`, also inside an attachment); null otherwise.",
    )

    @classmethod
    def from_verified(cls, verified: VerifiedField) -> FieldResult:
        evidence = verified.evidence
        return cls(
            value=verified.value,
            status=verified.status,
            evidence=(
                Evidence(segment_id=evidence.segment_id, quote=evidence.quote) if evidence else None
            ),
            model_status=verified.model_status,
            reason=verified.reason,
        )


class ExtractedFields(BaseModel):
    """Field keys are fixed snake_case identifiers shared with the TS side."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    company: FieldResult = Field(description="Requesting company; trimmed text.")
    contact_person: FieldResult = Field(description="Contact person; trimmed text.")
    email: FieldResult = Field(description="Requester's e-mail address; lowercased.")
    phone: FieldResult = Field(
        description="Requester's phone number; trimmed as written, no country code added."
    )
    requested_delivery_date: FieldResult = Field(
        description="Requested delivery date as YYYY-MM-DD; a calendar week without a date is "
        "at most `uncertain` (reason `calendar_week_only`, value `KW 42` or `KW 42/2026`)."
    )
    additional_requirements: FieldResult = Field(
        description="Additional requirements (certificates, tolerances, ...); trimmed text."
    )

    @classmethod
    def from_verified(cls, fields: Mapping[FieldKey, VerifiedField]) -> ExtractedFields:
        return cls.model_validate(
            {key: FieldResult.from_verified(fields[key]) for key in FIELD_KEYS}
        )


class LineItem(_Camel):
    """One requested position; every field is verified on its own (same rules as header fields)."""

    index: int = Field(ge=0, description="0-based position in the document order.")
    description: FieldResult = Field(description="Product or article; trimmed text.")
    quantity: FieldResult = Field(
        description='Quantity as a plain decimal with a dot and no grouping ("1250", "2.5").'
    )
    unit: FieldResult = Field(
        description="Unit: one of mm, cm, m, kg, t, pcs (Stk., St., Stueck -> pcs) when known; "
        "otherwise the unit as written, trimmed."
    )
    material: FieldResult = Field(description="Material or material number; trimmed text.")
    dimensions: FieldResult = Field(description="Dimensions or nominal size; trimmed text.")

    @classmethod
    def from_verified(cls, item: VerifiedLineItem) -> LineItem:
        return cls.model_validate(
            {
                "index": item.index,
                **{key: FieldResult.from_verified(item.fields[key]) for key in LINE_ITEM_KEYS},
            }
        )


class TokenUsage(_Camel):
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None


class RunMetadata(_Camel):
    model_id: str
    model_version: str | None = Field(description="Model version reported by the provider.")
    prompt_version: str
    schema_version: str
    pdf_pipeline: Literal["textlines", "layout"] | None = Field(
        description="PDF pipeline used; null when no PDF was parsed (neither the document nor "
        "one of its attachments)."
    )
    tokens: TokenUsage
    latency_ms: int = Field(description="Server-side time for parse + extract + verify.")
    model_latency_ms: int | None = Field(description="Time of the model call; null if skipped.")


class AttachmentResult(_Camel):
    """One attachment of an Outlook ``.msg`` (also nested ones), parsed or not."""

    path: list[int] = Field(
        description="0-based attachment index per nesting level, outermost first; the last one "
        "is `attachment.index` in the locators of this attachment's segments."
    )
    name: str | None = Field(description="File name as stored in the message (untrusted text).")
    document_kind: DocumentKind | None = Field(description="Detected kind; null when failed.")
    status: Literal["parsed", "failed"]
    error: AttachmentError | None = Field(
        description="Why the attachment was not parsed; null when parsed. The message and its "
        "other attachments are still processed."
    )
    segment_count: int = Field(ge=0, description="Segments this attachment contributed.")

    @classmethod
    def from_report(cls, report: AttachmentReport) -> AttachmentResult:
        return cls(
            path=list(report.path),
            name=report.name,
            document_kind=report.kind,
            status=report.status,
            error=report.error,
            segment_count=report.segment_count,
        )


def _attachments_optional(schema: dict[str, object]) -> None:
    required = schema.get("required")
    if isinstance(required, list):
        schema["required"] = [name for name in required if name != "attachments"]


class ExtractResponse(_Camel):
    # `attachments` was added in #23: optional in the contract so older clients stay valid.
    model_config = ConfigDict(json_schema_extra=_attachments_optional)

    request_id: str
    document_id: str
    document_kind: DocumentKind = Field(
        description="Detected from the bytes: pdf, eml, xlsx, docx or msg (Outlook)."
    )
    segments: list[Segment]
    fields: ExtractedFields
    line_items: list[LineItem] = Field(
        description="Requested positions in document order (schemaVersion 2); empty when none."
    )
    run: RunMetadata
    warnings: list[Literal["no_text", "attachment_failed"]] = Field(
        description="`no_text`: the document has no text (e.g. a scan without OCR); no model "
        "call made. `attachment_failed`: at least one attachment of a `.msg` could not be "
        "parsed (see `attachments`); the rest was processed."
    )
    attachments: list[AttachmentResult] = Field(
        default_factory=list[AttachmentResult],
        description="Attachments of an Outlook `.msg`, flattened in document order (nested ones "
        "after their parent); empty for other kinds.",
    )


class ErrorDetail(_Camel):
    code: ErrorCode
    message: str = Field(description="Short, fixed text. Never contains document content.")


class ErrorResponse(_Camel):
    error: ErrorDetail
    request_id: str | None


class HealthResponse(BaseModel):
    status: Literal["ok"]
