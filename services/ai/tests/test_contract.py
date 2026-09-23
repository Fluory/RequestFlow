"""The committed OpenAPI contract equals the app's schema (the TS types are generated from it)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from requestflow_ai.api.openapi import build_openapi

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "ai-service.openapi.yaml"


def committed() -> dict[str, Any]:
    return yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))


def test_committed_contract_matches_the_app() -> None:
    assert build_openapi() == committed(), (
        "contract drift: run `uv run python scripts/export_openapi.py` and commit the result"
    )


def test_contract_is_openapi_3_1_with_bearer_auth_on_extract() -> None:
    spec = committed()
    assert spec["openapi"].startswith("3.1.")
    assert spec["components"]["securitySchemes"]["bearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
    }
    extract = spec["paths"]["/v1/extract"]["post"]
    assert extract["operationId"] == "extract"
    assert extract["security"] == [{"bearerAuth": []}]
    assert "security" not in spec["paths"]["/healthz"]["get"]
    for status in ("200", "400", "401", "411", "413", "415", "422", "429", "500", "502"):
        assert status in extract["responses"]


def test_contract_field_status_includes_unverified_but_model_schema_does_not() -> None:
    schemas = committed()["components"]["schemas"]
    assert schemas["FieldResult"]["properties"]["status"]["enum"] == [
        "found",
        "uncertain",
        "missing",
        "unverified",
    ]
    assert "ModelExtraction" not in schemas
    assert set(schemas["ExtractedFields"]["properties"]) == {
        "company",
        "contact_person",
        "requested_delivery_date",
    }
