"""Shared test setup. The suite never downloads models and never calls a live endpoint."""

from __future__ import annotations

import os
from pathlib import Path

# Set before anything imports huggingface_hub/docling: a test that needed a model download
# fails instead of silently reaching the network.
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from google.oauth2.credentials import Credentials

from requestflow_ai.config import Settings
from requestflow_ai.parsing.segments import BoundingBox, EmailLocator, PdfLocator, Segment

FIXTURES = Path(__file__).resolve().parent / "fixtures"
TEST_TOKEN = "test-token-0123456789abcdef-synthetic"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES


@dataclass
class Replay:
    """Replays a recorded Vertex response at the HTTP boundary and captures the requests."""

    status: int = 200
    body: dict[str, Any] | str = field(default_factory=dict[str, Any])
    requests: list[httpx.Request] = field(default_factory=list[httpx.Request])

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if isinstance(self.body, str):
            return httpx.Response(self.status, text=self.body)
        return httpx.Response(self.status, json=self.body)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))

    def request_json(self, index: int = -1) -> dict[str, Any]:
        return json.loads(self.requests[index].content)


def recorded(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / "vertex" / name).read_text(encoding="utf-8"))


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "ai_service_token": TEST_TOKEN,
        "vertex_project": "rf-synthetic-project",
    }
    values.update(overrides)
    return Settings.model_validate(values)


def fake_credentials() -> Credentials:
    # A static bearer token: never refreshed, never sent anywhere but the mock transport.
    return Credentials(token="fake-access-token")  # noqa: S106


def no_adc(**_: Any) -> Any:
    raise AssertionError("tests must not load application default credentials")


CredentialsLoader = Callable[..., Any]


def pdf_segment(segment_id: str, text: str, page: int = 1) -> Segment:
    return Segment(
        id=segment_id,
        text=text,
        locator=PdfLocator(page=page, bbox=BoundingBox(l=72, t=50, r=300, b=62)),
    )


def body_segment(segment_id: str, text: str, line: int = 1) -> Segment:
    return Segment(id=segment_id, text=text, locator=EmailLocator(part="body", line=line))
