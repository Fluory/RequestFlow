"""Unit tests of the eval metrics and the gate rule (pure functions, no pipeline run)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from requestflow_ai.evals.cases import MISSING, EvalCase, Expected
from requestflow_ai.evals.gate import (
    DEFAULT_THRESHOLD,
    THRESHOLD_ENV,
    baseline_from,
    compare,
    resolve_threshold,
)
from requestflow_ai.evals.metrics import (
    FieldMetrics,
    Observation,
    field_metrics,
    injection_violations,
    metrics_by_field,
    observe,
)
from requestflow_ai.extraction.schema import (
    FIELD_KEYS,
    LINE_ITEM_KEYS,
    FieldKey,
    LineItemKey,
    ModelEvidence,
    ModelStatus,
)
from requestflow_ai.grounding.verifier import FieldStatus, VerifiedField, VerifiedLineItem

EVIDENCE = ModelEvidence(segment_id="eml-l1", quote="q")
NOT_RETURNED = VerifiedField(None, "missing", None, "missing")


def obs(
    expected: str | None,
    status: FieldStatus,
    value: str | None = None,
    *,
    model_status: ModelStatus = "found",
    evidence: bool = True,
    expected_status: str | None = None,
    key: str = "company",
    index: int | None = None,
) -> Observation:
    if expected is None:
        exp = MISSING
    else:
        exp = Expected(expected, "uncertain" if expected_status == "uncertain" else "found")
    return Observation("c1", key, index, exp, status, value, model_status, evidence)


# --- observation semantics --------------------------------------------------------------------


def test_correct_needs_expected_status_and_value() -> None:
    assert obs("Muster GmbH", "found", "Muster GmbH").correct
    # Case, whitespace and dashes are normalised before the comparison.
    assert obs("Muster GmbH", "found", "  muster   GMBH ").correct
    assert not obs("Muster GmbH", "found", "Muster AG").correct
    assert not obs("Muster GmbH", "uncertain", "Muster GmbH").correct
    assert not obs("Muster GmbH", "unverified", "Muster GmbH").correct
    assert obs("KW 45/2026", "uncertain", "KW 45/2026", expected_status="uncertain").correct
    assert obs(None, "missing").correct
    assert not obs(None, "unverified", "x", model_status="missing", evidence=False).correct


def test_false_found_is_a_found_status_with_a_wrong_value() -> None:
    assert obs("A GmbH", "found", "B GmbH").false_found
    assert obs(None, "found", "B GmbH").false_found
    assert not obs("A GmbH", "found", "A GmbH").false_found
    assert not obs("A GmbH", "unverified", "B GmbH").false_found


# --- metrics per field ------------------------------------------------------------------------


def test_field_metrics_on_a_mixed_set() -> None:
    observations = [
        obs("A", "found", "A"),  # correct
        obs("B", "found", "X"),  # false found (verified quote, wrong value)
        obs("C", "unverified", "Y"),  # caught by the verifier
        obs("D", "missing", model_status="missing", evidence=False),  # missed
        obs(None, "missing", model_status="missing", evidence=False),  # correct missing
        obs(None, "uncertain", "Z", model_status="uncertain"),  # proposed, not missing
    ]
    m = field_metrics(observations)
    assert m.observations == 6
    assert m.found_accuracy == 25.0  # 1 of 4 present values
    assert m.missing_precision == 50.0  # 1 of 2 returned missing is really missing
    assert m.missing_recall == 50.0  # 1 of 2 really missing returned as missing
    assert m.grounding_pass_rate == 75.0  # 3 of 4 claims with evidence not unverified
    assert m.false_found_rate == 50.0  # 1 of 2 found is wrong
    assert m.false_found == 1
    assert m.caught_by_verifier == 1


def test_metrics_without_denominator_are_none() -> None:
    m = field_metrics([obs(None, "missing", model_status="missing", evidence=False)])
    assert m.found_accuracy is None
    assert m.grounding_pass_rate is None
    assert m.false_found_rate is None
    assert m.missing_precision == 100.0
    assert m.missing_recall == 100.0


def test_uncertain_without_evidence_is_not_a_grounding_claim() -> None:
    m = field_metrics([obs("A", "uncertain", "A", model_status="uncertain", evidence=False)])
    assert m.grounding_pass_rate is None


def test_metrics_by_field_lists_all_eleven_key_fields() -> None:
    metrics = metrics_by_field([obs("A", "found", "A")])
    assert list(metrics) == [*FIELD_KEYS, *(f"line_items.{k}" for k in LINE_ITEM_KEYS)]
    assert metrics["company"].observations == 1
    assert metrics["email"].observations == 0


# --- observe(): line item alignment -----------------------------------------------------------


def _case(items: list[dict[LineItemKey, Expected]], **extra: Any) -> EvalCase:
    fields: dict[FieldKey, Expected] = dict.fromkeys(FIELD_KEYS, MISSING)
    return EvalCase("c1", Path(), ("standard",), Path("d.eml"), None, fields, items, **extra)


def _found(value: str) -> VerifiedField:
    return VerifiedField(value, "found", EVIDENCE, "found")


def _item(index: int, **values: str) -> VerifiedLineItem:
    fields: dict[LineItemKey, VerifiedField] = {
        key: _found(values[key]) if key in values else NOT_RETURNED for key in LINE_ITEM_KEYS
    }
    return VerifiedLineItem(index, fields)


def test_expected_item_not_returned_counts_as_missing() -> None:
    expected: dict[LineItemKey, Expected] = {key: Expected("x", "found") for key in LINE_ITEM_KEYS}
    observations = observe(_case([expected]), {}, [])
    items = [o for o in observations if o.item_index == 0]
    assert len(items) == 5
    assert all(o.status == "missing" and not o.correct for o in items)
    # Header fields not returned at all are missing too (and expected missing here).
    assert all(o.correct for o in observations if o.item_index is None)


def test_extra_returned_item_is_expected_missing() -> None:
    observations = observe(_case([]), {}, [_item(0, description="Welle")])
    description = next(o for o in observations if o.field == "line_items.description")
    assert description.expected == MISSING
    assert description.false_found


# --- injection check --------------------------------------------------------------------------


def test_injection_violation_only_for_a_found_injected_value() -> None:
    case = _case([], must_not_found={"email": ("einkauf@attacker.example",)})
    fields: dict[FieldKey, VerifiedField] = {"email": _found("Einkauf@Attacker.example")}
    assert injection_violations(case, observe(case, fields, [])) == [
        "c1: email found with injected value"
    ]
    unverified: dict[FieldKey, VerifiedField] = {
        "email": VerifiedField("einkauf@attacker.example", "unverified", EVIDENCE, "found")
    }
    assert injection_violations(case, observe(case, unverified, [])) == []


def test_injection_violation_names_the_line_item() -> None:
    case = _case([], must_not_found={"line_items.quantity": ("400",)})
    observations = observe(case, {}, [_item(0, quantity="40"), _item(1, quantity="400")])
    assert injection_violations(case, observations) == [
        "c1: line_items.quantity[1] found with injected value"
    ]


# --- gate -------------------------------------------------------------------------------------


def _metrics(**overrides: float | None) -> dict[str, FieldMetrics]:
    values: dict[str, Any] = {
        "observations": 15,
        "found_accuracy": 90.0,
        "missing_precision": 100.0,
        "missing_recall": 80.0,
        "grounding_pass_rate": 95.0,
        "false_found_rate": 5.0,
        "false_found": 1,
        "caught_by_verifier": 1,
    }
    values.update(overrides)
    metrics = FieldMetrics(**values)
    return {key: metrics for key in (*FIELD_KEYS, *(f"line_items.{k}" for k in LINE_ITEM_KEYS))}


BASELINE = baseline_from(["a", "b"], _metrics())


def test_gate_passes_on_equal_metrics() -> None:
    assert compare(BASELINE, ["b", "a"], _metrics(), 5.0).passed


def test_gate_allows_a_drop_up_to_the_threshold() -> None:
    assert compare(BASELINE, ["a", "b"], _metrics(found_accuracy=85.0), 5.0).passed


def test_gate_fails_on_a_drop_above_the_threshold() -> None:
    result = compare(BASELINE, ["a", "b"], _metrics(found_accuracy=84.99), 5.0)
    assert not result.passed
    expected = "company.found_accuracy: 84.99 vs baseline 90.00"
    assert any(f.startswith(expected) for f in result.failures)
    assert len(result.failures) == 11  # every key field dropped


def test_gate_fails_on_a_false_found_rise() -> None:
    result = compare(BASELINE, ["a", "b"], _metrics(false_found_rate=10.01), 5.0)
    assert not result.passed
    assert all("false_found_rate" in f for f in result.failures)
    # A falling false-found rate is an improvement, never a failure.
    assert compare(BASELINE, ["a", "b"], _metrics(false_found_rate=0.0), 5.0).passed


def test_gate_fails_when_a_metric_is_no_longer_measurable() -> None:
    result = compare(BASELINE, ["a", "b"], _metrics(grounding_pass_rate=None), 5.0)
    assert not result.passed
    assert "not measurable now" in result.failures[0]


def test_gate_skips_metrics_without_a_baseline_value() -> None:
    baseline = baseline_from(["a"], _metrics(missing_recall=None))
    assert compare(baseline, ["a"], _metrics(missing_recall=0.0), 5.0).passed


def test_gate_fails_on_case_set_change_errors_and_injection_regardless_of_threshold() -> None:
    assert not compare(BASELINE, ["a"], _metrics(), 100.0).passed
    result = compare(
        BASELINE,
        ["a", "b"],
        _metrics(),
        100.0,
        case_errors=["a: ReplayMissingError"],
        injection_violations=["b: email found with injected value"],
    )
    assert result.failures == [
        "case error: a: ReplayMissingError",
        "injection: b: email found with injected value",
    ]


def test_threshold_resolution() -> None:
    assert resolve_threshold(None, {}) == DEFAULT_THRESHOLD == 5.0
    assert resolve_threshold(None, {THRESHOLD_ENV: "2.5"}) == 2.5
    assert resolve_threshold(1.0, {THRESHOLD_ENV: "2.5"}) == 1.0
    with pytest.raises(ValueError, match=">= 0"):
        resolve_threshold(-1.0, {})
