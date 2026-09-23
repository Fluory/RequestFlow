"""CLI, run from ``services/ai``: ``uv run python -m requestflow_ai.evals (--replay | --live)``.

Exit codes: 0 gate passed (or no gate), 1 gate failed, 2 usage or setup error.
"""

from __future__ import annotations

import os

# Before anything imports docling/huggingface_hub: the textlines PDF path needs no model, and an
# eval run must never download one.
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from requestflow_ai.evals.cases import CaseError, EvalCase, load_cases
from requestflow_ai.evals.gate import THRESHOLD_ENV, baseline_from, compare, resolve_threshold
from requestflow_ai.evals.model import LiveModeRefusedError, live_model, live_settings, replay_model
from requestflow_ai.evals.runner import report, run_cases, table
from requestflow_ai.extraction.model_client import ModelClient, ModelClientInitError

DEFAULT_CASES = Path("evals/cases")
DEFAULT_BASELINE = Path("evals/baseline.json")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m requestflow_ai.evals", description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--replay", action="store_true", help="replay recorded model responses (CI, no creds)"
    )
    mode.add_argument(
        "--live",
        action="store_true",
        help="call Vertex AI and record responses into the cases (never in CI)",
    )
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES, help="cases directory")
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE, help="baseline file")
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        help=f"max. allowed drop per metric in points (default: ${THRESHOLD_ENV} or 5)",
    )
    parser.add_argument("--report", type=Path, default=None, help="write the JSON report here")
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="write the baseline from this replay run instead of gating (never in CI)",
    )
    return parser


def main(argv: Sequence[str] | None = None, environ: Mapping[str, str] | None = None) -> int:
    env = os.environ if environ is None else environ
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        threshold = resolve_threshold(args.threshold, env)
    except ValueError as exc:
        parser.error(str(exc))
    if args.update_baseline and (args.live or env.get("CI")):
        parser.error("--update-baseline only with --replay and never in CI")

    try:
        cases = load_cases(args.cases)
    except CaseError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.live:
        try:
            settings = live_settings(env)
        except (LiveModeRefusedError, ModelClientInitError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2

        def factory(case: EvalCase) -> ModelClient:
            return live_model(settings, case.model_response)

        run = run_cases(cases, factory, "live")
    else:
        run = run_cases(cases, lambda case: replay_model(case.model_response), "replay")

    print(table(run))
    for error in run.case_errors:
        print(f"case error: {error}", file=sys.stderr)

    if args.update_baseline:
        if run.case_errors or run.injection_violations:
            print(
                "error: refusing to write a baseline from a run with case errors or "
                "injection violations",
                file=sys.stderr,
            )
            return 1
        baseline = baseline_from(run.case_ids, run.metrics())
        args.baseline.write_text(json.dumps(baseline, indent=2) + "\n", encoding="utf-8")
        print(f"baseline written to {args.baseline}")
        _write_report(args.report, report(run, None, threshold))
        return 0

    try:
        baseline: dict[str, Any] = json.loads(args.baseline.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"error: cannot read baseline {args.baseline}: {exc}", file=sys.stderr)
        return 2
    result = compare(
        baseline,
        run.case_ids,
        run.metrics(),
        threshold,
        case_errors=run.case_errors,
        injection_violations=run.injection_violations,
    )
    _write_report(args.report, report(run, result.failures, threshold))
    if result.passed:
        print(f"eval gate PASSED ({run.mode}, {len(cases)} cases, threshold {threshold:g} points)")
        return 0
    print(f"eval gate FAILED ({run.mode}, threshold {threshold:g} points):", file=sys.stderr)
    for failure in result.failures:
        print(f"  - {failure}", file=sys.stderr)
    return 1


def _write_report(path: Path | None, data: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"report written to {path}")


if __name__ == "__main__":
    sys.exit(main())
