"""API response models; the OpenAPI component schemas are generated from these names."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from requestflow_ai.extraction.schema import ModelStatus
from requestflow_ai.grounding.verifier import FieldStatus, UnverifiedReason, VerifiedField
from requestflow_ai.parsing.segments import Segment

ErrorCode = Literal[
    "invalid_request",
    "unauthorized",
    "document_too_large",
    "unsupported_media_type",
    "document_unparseable",
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
        "trimmed text, dates as YYYY-MM-DD. Kept as the model sent it for `unverified` (and for "
        "`uncertain` without evidence) so a human can review the proposal; null for `missing`."
    )
    status: FieldStatus = Field(
        description="Final status after verification. `found` only if the verifier confirmed the "
        "quote in the cited segment and the value against the quote."
    )
    evidence: Evidence | None
    model_status: ModelStatus = Field(description="What the model claimed before verification.")
    reason: UnverifiedReason | None = Field(
        default=None,
        description="Why the verifier set `unverified`, or `ambiguous_quote` when it downgraded "
        "`found` to `uncertain` (the quote holds several dates); null otherwise.",
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

    company: FieldResult
    contact_person: FieldResult
    requested_delivery_date: FieldResult


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
        description="PDF pipeline used; null for e-mails."
    )
    tokens: TokenUsage
    latency_ms: int = Field(description="Server-side time for parse + extract + verify.")
    model_latency_ms: int | None = Field(description="Time of the model call; null if skipped.")


class ExtractResponse(_Camel):
    request_id: str
    document_id: str
    document_kind: Literal["pdf", "eml"]
    segments: list[Segment]
    fields: ExtractedFields
    run: RunMetadata
    warnings: list[Literal["no_text"]] = Field(
        description="`no_text`: the document has no text layer (e.g. a scan); no model call made."
    )


class ErrorDetail(_Camel):
    code: ErrorCode
    message: str = Field(description="Short, fixed text. Never contains document content.")


class ErrorResponse(_Camel):
    error: ErrorDetail
    request_id: str | None


class HealthResponse(BaseModel):
    status: Literal["ok"]
