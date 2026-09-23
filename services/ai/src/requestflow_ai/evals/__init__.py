"""Eval runner for the production pipeline (ADR-0001 D8, issue #24).

Runs parse -> extract -> verify on the synthetic cases in ``services/ai/evals/cases/``, computes
metrics per key field and compares them with the committed baseline (the CI gate). The model is
either replayed from recorded ``generateContent`` responses (``--replay``, deterministic, no
credentials) or called live on Vertex AI, recording its responses (``--live``, never in CI).

Entry point (from ``services/ai``): ``uv run python -m requestflow_ai.evals --replay``.
"""
