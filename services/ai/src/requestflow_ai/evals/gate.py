"""The eval gate: compare a run with the committed baseline.

Rule (every key field = six header fields + five line item fields, every metric in
``METRIC_NAMES``, values in percent):

* a metric fails when it is worse than the baseline by **more than** ``threshold`` points –
  lower for ``found_accuracy``, ``missing_precision``, ``missing_recall``,
  ``grounding_pass_rate``; higher for ``false_found_rate``;
* a metric the baseline has but the run cannot compute any more (denominator 0) fails;
  a metric the baseline does not have (``null``) is not gated;
* independent of the threshold, the gate fails on any case error, on any injection violation
  (an injected value came out ``found``) and when the run's case ids differ from the baseline's
  (adding or removing a case needs a reviewed ``--update-baseline``).

The threshold defaults to 5 points (``--threshold`` / ``EVAL_GATE_THRESHOLD``). With 15 cases one
header field has 15 observations, so one case is ~6.7 points: at the default threshold any single
header field regression fails the gate.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, cast

from requestflow_ai.evals.cases import KEY_FIELDS
from requestflow_ai.evals.metrics import LOWER_IS_BETTER, METRIC_NAMES, FieldMetrics

DEFAULT_THRESHOLD = 5.0
THRESHOLD_ENV = "EVAL_GATE_THRESHOLD"

Baseline = Mapping[str, Any]


@dataclass(frozen=True)
class GateResult:
    failures: list[str]

    @property
    def passed(self) -> bool:
        return not self.failures


def resolve_threshold(cli_value: float | None, environ: Mapping[str, str]) -> float:
    if cli_value is not None:
        threshold = cli_value
    elif environ.get(THRESHOLD_ENV):
        threshold = float(environ[THRESHOLD_ENV])
    else:
        threshold = DEFAULT_THRESHOLD
    if threshold < 0:
        raise ValueError("the gate threshold must be >= 0 points")
    return threshold


def baseline_from(case_ids: list[str], metrics: Mapping[str, FieldMetrics]) -> dict[str, Any]:
    return {
        "note": "Committed eval baseline (replay mode). Update only with a reviewed "
        "`--update-baseline`; never in CI.",
        "case_ids": sorted(case_ids),
        "metrics": {
            key: {name: metrics[key].metric(name) for name in METRIC_NAMES} for key in KEY_FIELDS
        },
    }


def compare(
    baseline: Baseline,
    case_ids: list[str],
    metrics: Mapping[str, FieldMetrics],
    threshold: float,
    *,
    case_errors: list[str] | None = None,
    injection_violations: list[str] | None = None,
) -> GateResult:
    failures: list[str] = [f"case error: {error}" for error in case_errors or []]
    failures += [f"injection: {violation}" for violation in injection_violations or []]

    if sorted(case_ids) != sorted(cast(list[str], baseline.get("case_ids", []))):
        failures.append(
            "case set differs from the baseline: review and run --update-baseline"
        )

    base_metrics = cast(Mapping[str, Mapping[str, Any]], baseline.get("metrics", {}))
    for key in KEY_FIELDS:
        base_field = base_metrics.get(key)
        if base_field is None:
            failures.append(f"{key}: missing from the baseline")
            continue
        current = metrics.get(key)
        for name in METRIC_NAMES:
            before = base_field.get(name)
            if before is None:
                continue
            now = current.metric(name) if current is not None else None
            if now is None:
                failures.append(f"{key}.{name}: {before:.2f} in the baseline, not measurable now")
                continue
            worse_by = (now - before) if name in LOWER_IS_BETTER else (before - now)
            if worse_by > threshold:
                failures.append(
                    f"{key}.{name}: {now:.2f} vs baseline {before:.2f} "
                    f"(worse by {worse_by:.2f} > {threshold:g} points)"
                )
    return GateResult(failures)
