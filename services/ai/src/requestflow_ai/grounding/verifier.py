"""Grounding verifier (ADR-0001 D8 step 3, test-first).

Rules, applied in order:

* ``missing``: the value must be null, otherwise ``unverified`` (``missing_with_value``). Stray
  evidence is dropped.
* ``found``: needs a value and evidence. The cited segment must exist, the normalised quote must
  occur in the normalised segment text, and the value must be consistent with the quote (text,
  number or date semantics per field). Any failure -> ``unverified`` with a reason. Text must
  match on word boundaries; a verified value is returned normalised (trimmed text, dates as ISO
  ``YYYY-MM-DD``). A date quote with more than one distinct date proves nothing about which one
  is meant: ``found`` is downgraded to ``uncertain`` (reason ``ambiguous_quote``).
* ``uncertain``: evidence, when given, is checked the same way (failure -> ``unverified``).
  Without evidence it stays ``uncertain``. It is never promoted to ``found``.

The model never has the final say on ``found``; the verifier only ever keeps or downgrades.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from requestflow_ai.extraction.schema import (
    FIELD_KEYS,
    FieldKey,
    ModelEvidence,
    ModelExtraction,
    ModelField,
    ModelStatus,
)
from requestflow_ai.grounding.normalize import normalize_text
from requestflow_ai.grounding.values import ValueCheck, ValueKind, check_value
from requestflow_ai.parsing.segments import Segment

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
]

FIELD_KINDS: dict[FieldKey, ValueKind] = {
    "company": "text",
    "contact_person": "text",
    "requested_delivery_date": "date",
}


@dataclass(frozen=True)
class VerifiedField:
    value: str | None
    status: FieldStatus
    evidence: ModelEvidence | None
    model_status: ModelStatus
    reason: UnverifiedReason | None = None


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
    # A verified value is returned normalised (trimmed text, ISO date), never the raw model text.
    value = check.normalized if check.normalized is not None else field.value
    if check.ambiguous and model_status == "found":
        return VerifiedField(value, "uncertain", field.evidence, model_status, "ambiguous_quote")
    return VerifiedField(value, model_status, field.evidence, model_status)


def verify_extraction(
    extraction: ModelExtraction, segments: Sequence[Segment]
) -> dict[FieldKey, VerifiedField]:
    by_id = {segment.id: segment for segment in segments}
    return {
        key: verify_field(getattr(extraction, key), FIELD_KINDS[key], by_id) for key in FIELD_KEYS
    }
