"""The Vercel entry module exposes the configured app (ADR-0001 D11 amendment 2026-09-26)."""

from __future__ import annotations

import importlib
import sys

import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from conftest import TEST_TOKEN

ENTRY = "requestflow_ai.vercel_app"


def _import_entry() -> object:
    sys.modules.pop(ENTRY, None)
    return importlib.import_module(ENTRY)


def test_exposes_the_extract_api_as_app(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_SERVICE_TOKEN", TEST_TOKEN)
    monkeypatch.setenv("AI_ALLOW_GEMINI_API_DEV", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-test-key-not-real")
    monkeypatch.delenv("VERTEX_PROJECT", raising=False)

    module = _import_entry()

    app = getattr(module, "app")
    assert isinstance(app, FastAPI)
    assert "/v1/extract" in {getattr(route, "path", "") for route in app.routes}


def test_refuses_to_start_without_a_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("AI_ALLOW_GEMINI_API_DEV", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-test-key-not-real")

    with pytest.raises(ValidationError, match="ai_service_token"):
        _import_entry()
