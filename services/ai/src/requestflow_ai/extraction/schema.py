"""Model-facing output schema (sent to Gemini as ``response_schema``).

This is deliberately a separate set of classes from the API response: the model may only say
``found | uncertain | missing``. ``unverified`` exists only in the API result and is set by the
grounding verifier, never by the model.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# "header-v1": company, contact person, delivery date. "2" (#22): + e-mail, phone, additional
# requirements and line items.
SCHEMA_VERSION = "2"

FieldKey = Literal[
    "company",
    "contact_person",
    "email",
    "phone",
    "requested_delivery_date",
    "additional_requirements",
]
FIELD_KEYS: tuple[FieldKey, ...] = (
    "company",
    "contact_person",
    "email",
    "phone",
    "requested_delivery_date",
    "additional_requirements",
)

LineItemKey = Literal["description", "quantity", "unit", "material", "dimensions"]
LINE_ITEM_KEYS: tuple[LineItemKey, ...] = (
    "description",
    "quantity",
    "unit",
    "material",
    "dimensions",
)

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


class ModelLineItem(BaseModel):
    description: ModelField = Field(description="Product or article as written.")
    quantity: ModelField = Field(description="Quantity as written, number only.")
    unit: ModelField = Field(description="Unit of the quantity as written (Stk., m, kg, ...).")
    material: ModelField = Field(description="Material or material number as written.")
    dimensions: ModelField = Field(description="Dimensions or nominal size as written.")


class ModelExtraction(BaseModel):
    company: ModelField = Field(description="Requesting company (legal name).")
    contact_person: ModelField = Field(description="Named contact person at that company.")
    email: ModelField = Field(description="E-mail address of the requester.")
    phone: ModelField = Field(description="Phone number of the requester as written.")
    requested_delivery_date: ModelField = Field(
        description="Requested delivery date as ISO 8601 date (YYYY-MM-DD), or the calendar "
        "week as written (for example KW 42) when no date is stated."
    )
    additional_requirements: ModelField = Field(
        description="Additional requirements (certificates, tolerances, packaging) as written."
    )
    line_items: list[ModelLineItem] = Field(
        description="Requested positions in document order; empty when there are none."
    )
