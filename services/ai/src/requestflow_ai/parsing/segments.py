"""Segments: the unit the model cites and the verifier checks against.

A segment is one line of document text with a stable locator. Segment ids are deterministic for
the same input bytes (``p{page}-l{line}`` for PDF, ``eml-l{line}`` for an e-mail body), so a
stored evidence reference still resolves when the document is parsed again.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class BoundingBox(_ApiModel):
    """Box in PDF points; origin top-left of the page (``t`` < ``b``)."""

    l: float  # noqa: E741 - docling's own naming (left, top, right, bottom)
    t: float
    r: float
    b: float


class PdfLocator(_ApiModel):
    kind: Literal["pdf"] = "pdf"
    page: int = Field(ge=1, description="1-based page number.")
    bbox: BoundingBox
    coord_origin: Literal["TOPLEFT"] = "TOPLEFT"


class EmailLocator(_ApiModel):
    kind: Literal["email"] = "email"
    part: Literal["header", "body"]
    line: int = Field(
        ge=1,
        description="1-based line in the decoded text body (part=body) or header order (part=header).",
    )
    header: str | None = Field(default=None, description="Header name when part=header.")


Locator = Annotated[PdfLocator | EmailLocator, Field(discriminator="kind")]


class Segment(_ApiModel):
    id: str
    text: str
    locator: Locator
