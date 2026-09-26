"""Vercel entry shim (ADR-0001 D11 amendment 2026-09-26).

Vercel resolves ``[tool.vercel] entrypoint`` as a file next to pyproject.toml and does not know the
``src/`` layout (build error PYTHON_ENTRYPOINT_NOT_FOUND). This shim makes ``src/`` importable (a
no-op when the package is installed) and re-exports the tested app from
``requestflow_ai.vercel_app``.
"""

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from requestflow_ai.vercel_app import app  # noqa: E402

__all__ = ["app"]
