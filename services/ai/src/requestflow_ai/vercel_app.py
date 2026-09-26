"""Entry point for Vercel's Python runtime (ADR-0001 D11 amendment 2026-09-26).

Vercel imports a module-level ``app`` (``[tool.vercel] entrypoint`` in pyproject.toml). The
configuration comes from the environment exactly as for uvicorn's ``create_app`` factory, so a
missing or invalid setting fails at start (fail-closed) instead of serving a half-configured API.
"""

from requestflow_ai.api.app import create_app

app = create_app()
