"""Write the service's OpenAPI 3.1 contract to contracts/ai-service.openapi.yaml.

Run: uv run python scripts/export_openapi.py
tests/test_contract.py fails when the committed file and the app disagree.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from requestflow_ai.api.openapi import build_openapi

TARGET = Path(__file__).resolve().parents[3] / "contracts" / "ai-service.openapi.yaml"
HEADER = (
    "# GENERATED from services/ai (FastAPI + pydantic) - do not edit by hand.\n"
    "# Regenerate: cd services/ai && uv run python scripts/export_openapi.py\n"
    "# The TS client and types are generated from this file (ADR-0001 D8).\n"
)


def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    body = yaml.safe_dump(build_openapi(), sort_keys=False, allow_unicode=False, width=100)
    TARGET.write_text(HEADER + body, encoding="utf-8")
    print(f"wrote {TARGET}")


if __name__ == "__main__":
    main()
