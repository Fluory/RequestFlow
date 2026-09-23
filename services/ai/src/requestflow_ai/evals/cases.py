"""Eval cases: ``cases/<id>/`` with the input document, ``expected.json`` and, when the pipeline
calls the model, ``model_response.json`` (a ``generateContent`` response body).

``expected.json``::

    {
      "id": "<id>",                       # must equal the directory name
      "categories": ["table", ...],       # table | scanned | missing | injection | date | standard
      "description": "...",
      "document": "document.pdf",         # file name inside the case directory
      "declared_type": "application/pdf", # MIME type the worker would declare
      "fields": {"company": "X", "requested_delivery_date": {"value": "KW 45/2026",
                 "status": "uncertain"}, ...},   # all six header fields; null = not in document
      "line_items": [{"description": ..., "quantity": ..., "unit": ..., "material": ...,
                      "dimensions": ...}],
      "must_not_found": {"email": ["..."], "line_items.quantity": ["400"]}   # injection cases
    }

Expected values are in the verifier's normalised form (ISO dates, ``1250``, ``pcs``, lowercase
e-mail). A plain string means status ``found``; ``null`` means ``missing``; an object sets the
expected status explicitly (``uncertain`` for a calendar week). Other keys (``after_ocr``) are
documentation and ignored by the runner.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast, get_args

from requestflow_ai.extraction.schema import FIELD_KEYS, LINE_ITEM_KEYS, FieldKey, LineItemKey

ExpectedStatus = Literal["found", "uncertain", "missing"]
Category = Literal["table", "scanned", "missing", "injection", "date", "standard"]
CATEGORIES: tuple[Category, ...] = get_args(Category)

MODEL_RESPONSE_FILE = "model_response.json"
EXPECTED_FILE = "expected.json"

# Key fields of the gate: every header field and every line item field (schema v2).
ITEM_PREFIX = "line_items."
KEY_FIELDS: tuple[str, ...] = (*FIELD_KEYS, *(ITEM_PREFIX + key for key in LINE_ITEM_KEYS))


class CaseError(Exception):
    """A case directory is malformed."""


@dataclass(frozen=True)
class Expected:
    value: str | None
    status: ExpectedStatus


MISSING = Expected(None, "missing")


@dataclass(frozen=True)
class EvalCase:
    id: str
    directory: Path
    categories: tuple[Category, ...]
    document: Path
    declared_type: str | None
    fields: dict[FieldKey, Expected]
    line_items: list[dict[LineItemKey, Expected]]
    must_not_found: dict[str, tuple[str, ...]] = field(default_factory=dict[str, tuple[str, ...]])

    @property
    def model_response(self) -> Path:
        return self.directory / MODEL_RESPONSE_FILE


def _expected(raw: Any, where: str) -> Expected:
    if raw is None:
        return MISSING
    if isinstance(raw, str):
        return Expected(raw, "found")
    if isinstance(raw, dict):
        data = cast(dict[str, Any], raw)
        value, status = data.get("value"), data.get("status")
        if status in ("found", "uncertain") and isinstance(value, str):
            return Expected(value, cast(ExpectedStatus, status))
        if status == "missing" and value is None:
            return MISSING
    raise CaseError(f"{where}: invalid expected value")


def load_case(directory: Path) -> EvalCase:
    try:
        raw = json.loads((directory / EXPECTED_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CaseError(f"{directory.name}: cannot read {EXPECTED_FILE}") from exc
    if not isinstance(raw, dict):
        raise CaseError(f"{directory.name}: {EXPECTED_FILE} is not an object")
    data = cast(dict[str, Any], raw)
    case_id = data.get("id")
    if not isinstance(case_id, str) or case_id != directory.name:
        raise CaseError(f"{directory.name}: id {case_id!r} does not match the directory")

    categories = tuple(str(c) for c in cast(list[Any], data.get("categories") or []))
    if not categories or any(c not in CATEGORIES for c in categories):
        raise CaseError(f"{case_id}: categories must be a non-empty subset of {CATEGORIES}")

    document = directory / str(data.get("document", ""))
    if not document.is_file():
        raise CaseError(f"{case_id}: document {document.name!r} not found")

    raw_fields = cast(dict[str, Any], data.get("fields") or {})
    if set(raw_fields) != set(FIELD_KEYS):
        raise CaseError(f"{case_id}: fields must list exactly {FIELD_KEYS}")
    fields: dict[FieldKey, Expected] = {
        key: _expected(raw_fields[key], f"{case_id}.{key}") for key in FIELD_KEYS
    }

    items: list[dict[LineItemKey, Expected]] = []
    for index, raw_item in enumerate(cast(list[Any], data.get("line_items") or [])):
        item = cast(dict[str, Any], raw_item)
        if set(item) != set(LINE_ITEM_KEYS):
            raise CaseError(f"{case_id}: line item {index} must list exactly {LINE_ITEM_KEYS}")
        items.append(
            {
                key: _expected(item[key], f"{case_id}.line_items[{index}].{key}")
                for key in LINE_ITEM_KEYS
            }
        )

    must_not_found: dict[str, tuple[str, ...]] = {}
    for key, values in cast(dict[str, Any], data.get("must_not_found") or {}).items():
        if key not in KEY_FIELDS or not isinstance(values, list) or not values:
            raise CaseError(f"{case_id}: must_not_found.{key} is invalid")
        must_not_found[key] = tuple(str(v) for v in cast(list[Any], values))
    if "injection" in categories and not must_not_found:
        raise CaseError(f"{case_id}: an injection case needs must_not_found")

    declared = data.get("declared_type")
    return EvalCase(
        id=case_id,
        directory=directory,
        categories=cast(tuple[Category, ...], categories),
        document=document,
        declared_type=declared if isinstance(declared, str) else None,
        fields=fields,
        line_items=items,
        must_not_found=must_not_found,
    )


def load_cases(cases_dir: Path) -> list[EvalCase]:
    if not cases_dir.is_dir():
        raise CaseError(f"cases directory {cases_dir} not found")
    cases = [load_case(d) for d in sorted(cases_dir.iterdir()) if d.is_dir()]
    if not cases:
        raise CaseError(f"no cases in {cases_dir}")
    return cases
