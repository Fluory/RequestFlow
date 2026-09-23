"""Segments: the unit the model cites and the verifier checks against.

A segment is one line of document text with a stable locator. Segment ids are deterministic for
the same input bytes (``p{page}-l{line}`` for PDF, ``eml-l{line}`` for an e-mail body,
``s{sheet}-r{row}`` for a spreadsheet row, ``d-p{n}`` / ``d-t{t}-r{r}-c{c}`` for Word, ``msg-l{line}``
and ``msg-a{i}-<inner id>`` for Outlook), so a stored evidence reference still resolves when the
document is parsed again.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        frozen=True,
        # Fields with defaults are still always present in responses: mark them required.
        json_schema_serialization_defaults_required=True,
    )


class BoundingBox(_ApiModel):
    """Box in PDF points; origin top-left of the page (``t`` < ``b``)."""

    l: float  # noqa: E741 - docling's own naming (left, top, right, bottom)
    t: float
    r: float
    b: float


def _not_required(*names: str) -> Any:
    """``json_schema_extra`` hook: keep fields optional in the contract (additive growth)."""

    def hook(schema: dict[str, Any]) -> None:
        schema["required"] = [name for name in schema.get("required", []) if name not in names]

    return hook


class PdfLocator(_ApiModel):
    model_config = ConfigDict(json_schema_extra=_not_required("ocr"))

    kind: Literal["pdf"] = "pdf"
    page: int = Field(ge=1, description="1-based page number.")
    bbox: BoundingBox
    coord_origin: Literal["TOPLEFT"] = "TOPLEFT"
    ocr: bool = Field(
        default=False,
        description="True when the text comes from OCR of a page without a text layer. A field "
        "whose evidence is OCR text is at most `uncertain` (reason `ocr_only`). Optional: absent "
        "means false.",
    )


class EmailLocator(_ApiModel):
    kind: Literal["email"] = "email"
    part: Literal["header", "body"]
    line: int = Field(
        ge=1,
        description=(
            "1-based line in the decoded text body (part=body), "
            "or 1-based position in the header list (part=header)."
        ),
    )
    header: str | None = Field(default=None, description="Header name when part=header.")


class XlsxLocator(_ApiModel):
    """One spreadsheet row: its non-empty cells are joined with `` | `` in the segment text."""

    kind: Literal["xlsx"] = "xlsx"
    sheet: str = Field(description="Sheet name as in the workbook.")
    row: int = Field(ge=1, description="1-based row number.")
    cell_range: str = Field(
        description='Range of the non-empty cells of the row, e.g. "A7:D7" (or "B7" for one cell).'
    )


class DocxLocator(_ApiModel):
    """A body paragraph (``part=paragraph``) or one table cell (``part=table_cell``)."""

    kind: Literal["docx"] = "docx"
    part: Literal["paragraph", "table_cell"]
    paragraph: int | None = Field(
        default=None,
        ge=1,
        description="1-based index of the paragraph among the body paragraphs (empty ones count); "
        "null for a table cell.",
    )
    table: int | None = Field(default=None, ge=1, description="1-based table index in the body.")
    row: int | None = Field(default=None, ge=1, description="1-based row in the table.")
    cell: int | None = Field(
        default=None,
        ge=1,
        description="1-based grid column where the cell starts (a merged cell counts once).",
    )


class AttachmentRef(_ApiModel):
    index: int = Field(ge=0, description="0-based position among the message's attachments.")
    name: str | None = Field(description="File name as stored in the message (untrusted text).")


class MsgLocator(_ApiModel):
    """Outlook ``.msg``: header and body lines like ``email``; attachments wrap their own locator."""

    kind: Literal["msg"] = "msg"
    part: Literal["header", "body", "attachment"]
    line: int | None = Field(
        default=None,
        ge=1,
        description="1-based line in the decoded text body (part=body), or 1-based position in "
        "the header list (part=header); null for part=attachment.",
    )
    header: str | None = Field(default=None, description="Header name when part=header.")
    attachment: AttachmentRef | None = Field(
        default=None, description="The attachment holding the segment when part=attachment."
    )
    inner: Locator | None = Field(
        default=None,
        description="Locator inside the attachment (pdf, xlsx, docx, email or a nested msg) when "
        "part=attachment.",
    )


Locator = Annotated[
    PdfLocator | EmailLocator | XlsxLocator | DocxLocator | MsgLocator,
    Field(discriminator="kind"),
]
MsgLocator.model_rebuild()


def is_ocr(locator: Locator) -> bool:
    """True when the located text comes from OCR (also inside an attachment)."""
    if isinstance(locator, MsgLocator) and locator.inner is not None:
        return is_ocr(locator.inner)
    return isinstance(locator, PdfLocator) and locator.ocr


class Segment(_ApiModel):
    id: str
    text: str
    locator: Locator
