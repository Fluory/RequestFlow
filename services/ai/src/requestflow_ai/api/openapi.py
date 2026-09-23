"""Build the OpenAPI 3.1 document (exported to ``contracts/ai-service.openapi.yaml``)."""

from __future__ import annotations

from typing import Any

from fastapi.openapi.utils import get_openapi

from requestflow_ai.api.app import API_VERSION, build_api

_PARAGRAPHS = (
    "Stateless AI service of RequestFlow (ADR-0001 D8). The TS worker sends one document (PDF or "
    "RFC 5322 e-mail) plus opaque IDs; the service parses it into segments with stable locators, "
    "extracts header fields and line items with Gemini on Vertex AI (`eu`) and verifies every "
    "quote deterministically. The model never has the final say on `found`.",
    "The service has no database, no storage and no tenant logic. Authentication: bearer token "
    "(`AI_SERVICE_TOKEN`) on `/v1/extract`; `/healthz` is open.",
)
_DESCRIPTION = "\n\n".join(_PARAGRAPHS)


_RENAMES = {"Body_extract": "ExtractRequest"}  # FastAPI's generated name for the multipart body


def _rename_ref(ref: str) -> str:
    prefix, _, name = ref.rpartition("/")
    return f"{prefix}/{_RENAMES.get(name, name)}"


def _rename_refs(node: Any) -> Any:
    if isinstance(node, dict):
        return {
            key: _rename_ref(value)
            if key == "$ref" and isinstance(value, str)
            else _rename_refs(value)
            for key, value in node.items()
        }
    if isinstance(node, list):
        return [_rename_refs(item) for item in node]
    return node


def build_openapi() -> dict[str, Any]:
    app = build_api()  # routes only; no settings, no model client
    spec = get_openapi(
        title="RequestFlow AI service",
        version=API_VERSION,
        openapi_version="3.1.0",
        description=_DESCRIPTION,
        routes=app.routes,
    )
    schemas = spec["components"]["schemas"]
    for old, new in _RENAMES.items():
        schema = schemas.pop(old)
        schema["title"] = new
        schemas[new] = schema
    spec["components"]["schemas"] = dict(sorted(schemas.items()))
    return _rename_refs(spec)
