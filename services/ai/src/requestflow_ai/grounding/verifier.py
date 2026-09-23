"""Grounding verifier (ADR-0001 D8 step 3, test-first).

Rules, applied in order, identically to header fields and to every field of every line item:

* ``missing``: the value must be null, otherwise ``unverified`` (``missing_with_value``). Stray
  evidence is dropped.
* ``found``: needs a value and evidence. The cited segment must exist, the normalised quote must
  occur in the normalised segment text, and the value must be consistent with the quote (text,
  number, date, unit, e-mail or phone semantics per field). Any failure -> ``unverified`` with a
  reason. Text must match on word boundaries; a verified value is returned normalised (see
  ``grounding.values``). A date quote with more than one distinct date proves nothing about which
  one is meant: ``found`` is downgraded to ``uncertain`` (reason ``ambiguous_quote``). A date
  field that only has a calendar week is at most ``uncertain`` (reason ``calendar_week_only``).
  Evidence from an OCR segment (``locator.ocr``, also inside an attachment) proves only what the
  OCR read, not what the page says: ``found`` is downgraded to ``uncertain`` (reason ``ocr_only``).
* ``uncertain``: evidence, when given, is checked the same way (failure -> ``unverified``).
  Without evidence it stays ``uncertain``. It is never promoted to ``found``.

The model never has the final say on ``found``; the verifier only ever keeps or downgrades.
Line item indexes are assigned here from the order of the model's list, never taken from it.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from requestflow_ai.extraction.schema import (
    FIELD_KEYS,
    LINE_ITEM_KEYS,
    FieldKey,
    LineItemKey,
    ModelEvidence,
    ModelExtraction,
    ModelField,
    ModelStatus,
)
from requestflow_ai.grounding.normalize import normalize_text
from requestflow_ai.grounding.values import ValueCheck, ValueKind, check_value
from requestflow_ai.parsing.segments import Segment, is_ocr

FieldStatus = Literal["found", "uncertain", "missing", "unverified"]
UnverifiedReason = Literal[
    "missing_with_value",
    "no_value",
    "no_evidence",
    "unknown_segment",
    "empty_quote",
    "quote_not_in_segment",
    "value_not_in_quote",
    # Not unverified: a ``found`` date whose quote holds several dates is downgraded to
    # ``uncertain`` with this reason.
    "ambiguous_quote",
    # Not unverified: a date field that only has a calendar week (no date) is ``uncertain``.
    "calendar_week_only",
    # Not unverified: a ``found`` field whose evidence is OCR text is downgraded to ``uncertain``.
    "ocr_only",
]

FIELD_KINDS: dict[FieldKey, ValueKind] = {
    "company": "text",
    "contact_person": "text",
    "email": "email",
    "phone": "phone",
    "requested_delivery_date": "date",
    "additional_requirements": "text",
}

LINE_ITEM_KINDS: dict[LineItemKey, ValueKind] = {
    "description": "text",
    "quantity": "number",
    "unit": "unit",
    "material": "text",
    "dimensions": "text",
}


@dataclass(frozen=True)
class VerifiedField:
    value: str | None
    status: FieldStatus
    evidence: ModelEvidence | None
    model_status: ModelStatus
    reason: UnverifiedReason | None = None


@dataclass(frozen=True)
class VerifiedLineItem:
    index: int
    fields: dict[LineItemKey, VerifiedField]


def _check_evidence(
    value: str | None, evidence: ModelEvidence, kind: ValueKind, segments: Mapping[str, Segment]
) -> UnverifiedReason | ValueCheck:
    """A reason when the evidence fails; otherwise the value check (``ok`` for a null value)."""
    segment = segments.get(evidence.segment_id)
    if segment is None:
        return "unknown_segment"
    quote = normalize_text(evidence.quote)
    if not quote:
        return "empty_quote"
    if quote not in normalize_text(segment.text):
        return "quote_not_in_segment"
    if value is None:
        return ValueCheck(ok=True)
    check = check_value(kind, value, evidence.quote)
    if not check.ok:
        return "value_not_in_quote"
    return check


def verify_field(
    field: ModelField, kind: ValueKind, segments: Mapping[str, Segment]
) -> VerifiedField:
    model_status = field.status

    def unverified(reason: UnverifiedReason) -> VerifiedField:
        return VerifiedField(field.value, "unverified", field.evidence, model_status, reason)

    if model_status == "missing":
        if field.value is not None:
            return unverified("missing_with_value")
        return VerifiedField(None, "missing", None, model_status)

    if field.evidence is None:
        if model_status == "found":
            return unverified("no_evidence")
        return VerifiedField(field.value, "uncertain", None, model_status)

    if field.value is None and model_status == "found":
        return unverified("no_value")

    # uncertain without a value: the quote is still checked, the value check is skipped.
    check = _check_evidence(field.value, field.evidence, kind, segments)
    if not isinstance(check, ValueCheck):
        return unverified(check)
    # A verified value is returned normalised, never the raw model text.
    value = check.normalized if check.normalized is not None else field.value
    if check.calendar_week:
        return VerifiedField(value, "uncertain", field.evidence, model_status, "calendar_week_only")
    if check.ambiguous and model_status == "found":
        return VerifiedField(value, "uncertain", field.evidence, model_status, "ambiguous_quote")
    if model_status == "found" and is_ocr(segments[field.evidence.segment_id].locator):
        # The quote matched OCR text; OCR can misread, so a human confirms (issue #23).
        return VerifiedField(value, "uncertain", field.evidence, model_status, "ocr_only")
    return VerifiedField(value, model_status, field.evidence, model_status)


def verify_extraction(
    extraction: ModelExtraction, segments: Sequence[Segment]
) -> dict[FieldKey, VerifiedField]:
    by_id = {segment.id: segment for segment in segments}
    return {
        key: verify_field(getattr(extraction, key), FIELD_KINDS[key], by_id) for key in FIELD_KEYS
    }


def verify_line_items(
    extraction: ModelExtraction, segments: Sequence[Segment]
) -> list[VerifiedLineItem]:
    by_id = {segment.id: segment for segment in segments}
    return [
        VerifiedLineItem(
            index=index,
            fields={
                key: verify_field(getattr(item, key), LINE_ITEM_KINDS[key], by_id)
                for key in LINE_ITEM_KEYS
            },
        )
        for index, item in enumerate(extraction.line_items)
    ]
