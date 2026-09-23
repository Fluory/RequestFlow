"""Run the production pipeline on every case and build the report."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from requestflow_ai.evals.cases import EvalCase
from requestflow_ai.evals.metrics import (
    METRIC_NAMES,
    FieldMetrics,
    Observation,
    injection_violations,
    metrics_by_field,
    observe,
)
from requestflow_ai.evals.model import ReplayMissingError
from requestflow_ai.extraction.model_client import (
    ModelClient,
    ModelClientError,
    ModelClientInitError,
)
from requestflow_ai.extraction.prompt import PROMPT_VERSION
from requestflow_ai.extraction.schema import SCHEMA_VERSION
from requestflow_ai.pipeline import run_extraction

Mode = Literal["replay", "live"]
ModelFactory = Callable[[EvalCase], ModelClient]


@dataclass
class CaseResult:
    case: EvalCase
    observations: list[Observation] = field(default_factory=list[Observation])
    warnings: list[str] = field(default_factory=list[str])
    error: str | None = None
    violations: list[str] = field(default_factory=list[str])


@dataclass
class EvalRun:
    mode: Mode
    results: list[CaseResult]

    @property
    def case_ids(self) -> list[str]:
        return [r.case.id for r in self.results]

    @property
    def observations(self) -> list[Observation]:
        return [o for r in self.results for o in r.observations]

    @property
    def case_errors(self) -> list[str]:
        return [f"{r.case.id}: {r.error}" for r in self.results if r.error]

    @property
    def injection_violations(self) -> list[str]:
        return [v for r in self.results for v in r.violations]

    def metrics(self) -> dict[str, FieldMetrics]:
        # A failed case has no observations; the case error fails the gate on its own.
        return metrics_by_field(self.observations)


def run_case(case: EvalCase, model_factory: ModelFactory) -> CaseResult:
    result = CaseResult(case)
    try:
        run = run_extraction(
            case.document.read_bytes(),
            declared_type=case.declared_type,
            model=model_factory(case),
            pdf_pipeline="textlines",
        )
    except ModelClientInitError:
        # No client (e.g. no credentials in --live): abort the whole run, never record case by case.
        raise
    except Exception as exc:  # a broken case must fail the gate, not stop the other cases
        # Messages only from errors that are content-free by design; otherwise just the type.
        detail = f": {exc}" if isinstance(exc, ReplayMissingError | ModelClientError) else ""
        result.error = type(exc).__name__ + detail
        return result
    result.warnings = list(run.warnings)
    result.observations = observe(case, run.fields, run.line_items)
    result.violations = injection_violations(case, result.observations)
    return result


def run_cases(cases: Sequence[EvalCase], model_factory: ModelFactory, mode: Mode) -> EvalRun:
    return EvalRun(mode, [run_case(case, model_factory) for case in cases])


def report(run: EvalRun, gate_failures: list[str] | None, threshold: float) -> dict[str, Any]:
    metrics = run.metrics()
    return {
        "mode": run.mode,
        "prompt_version": PROMPT_VERSION,
        "schema_version": SCHEMA_VERSION,
        "threshold_points": threshold,
        "gate": None
        if gate_failures is None
        else {"passed": not gate_failures, "failures": gate_failures},
        "metrics": {
            key: {
                "observations": m.observations,
                **{name: m.metric(name) for name in METRIC_NAMES},
                "false_found": m.false_found,
                "caught_by_verifier": m.caught_by_verifier,
            }
            for key, m in metrics.items()
        },
        "cases": [
            {
                "id": r.case.id,
                "categories": list(r.case.categories),
                "error": r.error,
                "warnings": r.warnings,
                "injection_violations": r.violations,
                "correct": sum(o.correct for o in r.observations),
                "observations": [o.to_json() for o in r.observations],
            }
            for r in run.results
        ],
    }


def _cell(value: float | None) -> str:
    return "   -  " if value is None else f"{value:6.1f}"


def table(run: EvalRun) -> str:
    names = ("acc", "missP", "missR", "ground", "falseF")
    header = f"{'field':<26}{'n':>4} " + " ".join(f"{name:>6}" for name in names)
    lines = [header, "-" * len(header)]
    for key, m in run.metrics().items():
        cells = " ".join(_cell(m.metric(name)) for name in METRIC_NAMES)
        lines.append(f"{key:<26}{m.observations:>4} {cells}")
    return "\n".join(lines)
