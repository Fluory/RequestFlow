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
        "email",
        "phone",
        "requested_delivery_date",
        "additional_requirements",
    }


V1_FIELD_KEYS = {"company", "contact_person", "requested_delivery_date"}
LINE_ITEM_FIELDS = {"description", "quantity", "unit", "material", "dimensions"}


def test_contract_v2_is_additive_and_every_key_is_required() -> None:
    schemas = committed()["components"]["schemas"]
    fields = schemas["ExtractedFields"]
    # Backwards compatible: every v1 key is still there and still required.
    assert set(fields["required"]) >= V1_FIELD_KEYS
    assert set(fields["required"]) == set(fields["properties"])
    for key in fields["properties"]:
        assert fields["properties"][key]["$ref"] == "#/components/schemas/FieldResult"

    response = schemas["ExtractResponse"]
    assert "lineItems" in response["required"]
    assert response["properties"]["lineItems"]["type"] == "array"
    assert response["properties"]["lineItems"]["items"] == {"$ref": "#/components/schemas/LineItem"}

    item = schemas["LineItem"]
    assert set(item["properties"]) == {"index", *LINE_ITEM_FIELDS}
    assert set(item["required"]) == {"index", *LINE_ITEM_FIELDS}
    assert item["properties"]["index"]["type"] == "integer"
    assert item["properties"]["index"]["minimum"] == 0
    for key in LINE_ITEM_FIELDS:
        assert item["properties"][key]["$ref"] == "#/components/schemas/FieldResult"


def test_contract_reason_enum_grows_additively() -> None:
    reason = committed()["components"]["schemas"]["FieldResult"]["properties"]["reason"]
    values = [v for option in reason["anyOf"] for v in option.get("enum", [])]
    assert values == [
        "missing_with_value",
        "no_value",
        "no_evidence",
        "unknown_segment",
        "empty_quote",
        "quote_not_in_segment",
        "value_not_in_quote",
        "ambiguous_quote",
        "calendar_week_only",
        "ocr_only",  # #23, appended
    ]


def test_contract_formats_grow_additively() -> None:
    """#23: new document kinds, locators, OCR flag and attachment report; nothing removed."""
    schemas = committed()["components"]["schemas"]
    response = schemas["ExtractResponse"]
    assert response["properties"]["documentKind"]["enum"] == ["pdf", "eml", "xlsx", "docx", "msg"]
    # `ocr_pages_skipped` appended after the security review of PR #40 (additive).
    assert response["properties"]["warnings"]["items"]["enum"] == [
        "no_text",
        "attachment_failed",
        "ocr_pages_skipped",
    ]
    # New response field is optional so older clients stay valid.
    assert "attachments" in response["properties"]
    assert "attachments" not in response["required"]

    mapping = schemas["Segment"]["properties"]["locator"]["discriminator"]["mapping"]
    assert set(mapping) == {"pdf", "email", "xlsx", "docx", "msg"}

    pdf = schemas["PdfLocator"]
    assert pdf["required"] == ["kind", "page", "bbox", "coordOrigin"]  # unchanged
    assert pdf["properties"]["ocr"]["type"] == "boolean"
    assert pdf["properties"]["ocr"]["default"] is False

    assert set(schemas["XlsxLocator"]["required"]) == {"kind", "sheet", "row", "cellRange"}
    assert set(schemas["DocxLocator"]["properties"]) == {
        "kind",
        "part",
        "paragraph",
        "table",
        "row",
        "cell",
    }
    msg = schemas["MsgLocator"]["properties"]
    assert msg["part"]["enum"] == ["header", "body", "attachment"]
    inner_refs = {option["$ref"] for option in msg["inner"]["anyOf"][0]["oneOf"]}
    assert "#/components/schemas/MsgLocator" in inner_refs  # nested messages

    attachment = schemas["AttachmentResult"]["properties"]
    assert attachment["error"]["anyOf"][0]["enum"] == [
        "unsupported_media_type",
        "document_unparseable",
        "document_too_long",
        "nesting_too_deep",
        "too_many_attachments",
        "not_attached_by_value",
        "budget_exceeded",  # appended after the security review of PR #40 (additive)
    ]
