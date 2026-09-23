"""Model-facing output schema (sent to Gemini as ``response_schema``).

This is deliberately a separate set of classes from the API response: the model may only say
``found | uncertain | missing``. ``unverified`` exists only in the API result and is set by the
grounding verifier, never by the model.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "header-v1"

FieldKey = Literal["company", "contact_person", "requested_delivery_date"]
FIELD_KEYS: tuple[FieldKey, ...] = ("company", "contact_person", "requested_delivery_date")

ModelStatus = Literal["found", "uncertain", "missing"]


class ModelEvidence(BaseModel):
    segment_id: str = Field(description="Id of the one segment the quote is copied from.")
    quote: str = Field(description="Verbatim text copied from that segment.")


class ModelField(BaseModel):
    value: str | None = Field(description="Extracted value, or null when missing.")
    status: ModelStatus
    evidence: ModelEvidence | None = Field(
        description="Required for found and uncertain; null when missing."
    )


class ModelExtraction(BaseModel):
    company: ModelField = Field(description="Requesting company (legal name).")
    contact_person: ModelField = Field(description="Named contact person at that company.")
    requested_delivery_date: ModelField = Field(
        description="Requested delivery date as ISO 8601 date (YYYY-MM-DD)."
    )
