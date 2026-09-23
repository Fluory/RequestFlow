"""Metrics per key field (pure functions, no I/O).

One *observation* is one field of one case: a header field, or one field of one line item. Line
items are matched by index; an expected item the pipeline did not return counts as ``missing``,
an extra item the pipeline returned is expected to be all ``missing``.

Per key field, in percent (``None`` when the denominator is 0):

* ``found_accuracy`` – of the observations whose value is in the document, the share returned
  with the expected status (``found``, or ``uncertain`` for a calendar week) and the expected
  value. "Accuracy of found values"; it drops when a value is lost, wrong or unverified.
* ``missing_precision`` – of the observations returned as ``missing``, the share really missing.
* ``missing_recall`` – of the observations really missing, the share returned as ``missing``.
* ``grounding_pass_rate`` – of the observations where the model claimed a value with evidence
  (model status ``found`` or ``uncertain``), the share the verifier did not mark ``unverified``.
* ``false_found_rate`` – of the observations returned as ``found``, the share whose value is not
  the expected one (the hallucination indicator: a wrong value a reviewer would see as proven).
  Lower is better.

Values are compared after ``normalize_text`` (case, whitespace, dashes), on top of the verifier's
own normalisation.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass

from requestflow_ai.evals.cases import ITEM_PREFIX, KEY_FIELDS, MISSING, EvalCase, Expected
from requestflow_ai.extraction.schema import (
    FIELD_KEYS,
    LINE_ITEM_KEYS,
    FieldKey,
    LineItemKey,
    ModelStatus,
)
from requestflow_ai.grounding.normalize import normalize_text
from requestflow_ai.grounding.verifier import FieldStatus, VerifiedField, VerifiedLineItem

METRIC_NAMES = (
    "found_accuracy",
    "missing_precision",
    "missing_recall",
    "grounding_pass_rate",
    "false_found_rate",
)
# Metrics where a higher value is worse (the gate checks a rise instead of a drop).
LOWER_IS_BETTER = frozenset({"false_found_rate"})

_NOT_RETURNED = VerifiedField(None, "missing", None, "missing")


@dataclass(frozen=True)
class Observation:
    case_id: str
    field: str  # a key field: "company", ..., "line_items.quantity"
    item_index: int | None
    expected: Expected
    status: FieldStatus
    value: str | None
    model_status: ModelStatus
    has_evidence: bool

    @property
    def value_matches(self) -> bool:
        if self.expected.value is None or self.value is None:
            return False
        return normalize_text(self.value) == normalize_text(self.expected.value)

    @property
    def correct(self) -> bool:
        if self.expected.value is None:
            return self.status == "missing"
        return self.status == self.expected.status and self.value_matches

    @property
    def false_found(self) -> bool:
        return self.status == "found" and not self.value_matches

    def to_json(self) -> dict[str, object]:
        data = asdict(self)
        data["expected"] = {"value": self.expected.value, "status": self.expected.status}
        data["correct"] = self.correct
        return data


def _observation(
    case_id: str, key: str, index: int | None, expected: Expected, result: VerifiedField
) -> Observation:
    return Observation(
        case_id=case_id,
        field=key,
        item_index=index,
        expected=expected,
        status=result.status,
        value=result.value,
        model_status=result.model_status,
        has_evidence=result.evidence is not None,
    )


def observe(
    case: EvalCase,
    fields: Mapping[FieldKey, VerifiedField],
    line_items: Sequence[VerifiedLineItem],
) -> list[Observation]:
    """All observations of one case run (header fields first, then items in index order)."""
    observations = [
        _observation(case.id, key, None, case.fields[key], fields.get(key, _NOT_RETURNED))
        for key in FIELD_KEYS
    ]
    for index in range(max(len(case.line_items), len(line_items))):
        expected_item: Mapping[LineItemKey, Expected] = (
            case.line_items[index] if index < len(case.line_items) else {}
        )
        result_item: Mapping[LineItemKey, VerifiedField] = (
            line_items[index].fields if index < len(line_items) else {}
        )
        for key in LINE_ITEM_KEYS:
            observations.append(
                _observation(
                    case.id,
                    ITEM_PREFIX + key,
                    index,
                    expected_item.get(key, MISSING),
                    result_item.get(key, _NOT_RETURNED),
                )
            )
    return observations


def _percent(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round(100 * numerator / denominator, 2)


@dataclass(frozen=True)
class FieldMetrics:
    observations: int
    found_accuracy: float | None
    missing_precision: float | None
    missing_recall: float | None
    grounding_pass_rate: float | None
    false_found_rate: float | None
    # Counts for the report (not gated).
    false_found: int
    caught_by_verifier: int  # model said found, verifier said unverified

    def metric(self, name: str) -> float | None:
        value = getattr(self, name)
        return value if value is None else float(value)


def field_metrics(observations: Iterable[Observation]) -> FieldMetrics:
    obs = list(observations)
    present = [o for o in obs if o.expected.value is not None]
    absent = [o for o in obs if o.expected.value is None]
    returned_missing = [o for o in obs if o.status == "missing"]
    claimed = [o for o in obs if o.model_status in ("found", "uncertain") and o.has_evidence]
    found = [o for o in obs if o.status == "found"]
    false_found = sum(o.false_found for o in found)
    return FieldMetrics(
        observations=len(obs),
        found_accuracy=_percent(sum(o.correct for o in present), len(present)),
        missing_precision=_percent(
            sum(o.expected.value is None for o in returned_missing), len(returned_missing)
        ),
        missing_recall=_percent(sum(o.status == "missing" for o in absent), len(absent)),
        grounding_pass_rate=_percent(sum(o.status != "unverified" for o in claimed), len(claimed)),
        false_found_rate=_percent(false_found, len(found)),
        false_found=false_found,
        caught_by_verifier=sum(o.model_status == "found" and o.status == "unverified" for o in obs),
    )


def metrics_by_field(observations: Iterable[Observation]) -> dict[str, FieldMetrics]:
    obs = list(observations)
    return {key: field_metrics(o for o in obs if o.field == key) for key in KEY_FIELDS}


def injection_violations(case: EvalCase, observations: Iterable[Observation]) -> list[str]:
    """Fields of an injection case that came out ``found`` with a value the document injected."""
    violations: list[str] = []
    for o in observations:
        forbidden = case.must_not_found.get(o.field, ())
        if o.status != "found" or o.value is None:
            continue
        if normalize_text(o.value) in {normalize_text(v) for v in forbidden}:
            where = o.field if o.item_index is None else f"{o.field}[{o.item_index}]"
            violations.append(f"{case.id}: {where} found with injected value")
    return violations
