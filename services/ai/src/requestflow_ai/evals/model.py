"""Model clients for the eval runner. Both go through the production adapter.

The seam is the httpx transport that ``build_model_client`` accepts (``httpx_client``): the real
google-genai SDK and ``GeminiModelClient`` build the request and parse the response in both modes.

* Replay: a transport that answers ``generateContent`` with the case's recorded response body.
  Fail-closed: a request for a case without a recording raises ``ReplayMissingError`` (the case
  fails), it never falls back to anything else.
* Live: the SDK's normal transport, wrapped so the response body is written to the case's
  ``model_response.json`` (then replayable). Credentials come from ADC / Workload Identity via
  ``build_model_client``; any configuration problem raises ``ModelClientInitError``.

``tests/conftest.py`` has a similar ``Replay`` helper; it is test-only and captures requests for
assertions, so the runner has its own transport here instead of importing test code.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx
from google.oauth2.credentials import Credentials
from pydantic import SecretStr

from requestflow_ai.config import Settings
from requestflow_ai.extraction.model_client import (
    ModelClient,
    ModelClientInitError,
    build_model_client,
)

# Replay never authenticates anywhere: a static token that only reaches the in-process transport.
_REPLAY_TOKEN = "replay-only-not-a-credential"  # noqa: S105 - not a secret, never sent out
_REPLAY_SETTINGS: dict[str, Any] = {
    "ai_service_token": "eval-runner-replay-token-not-a-secret",
    "vertex_project": "rf-eval-replay",
    "vertex_location": "eu",
    "vertex_model": "gemini-3.5-flash",
    "ai_allow_gemini_api_dev": False,
}
# The runner is not the service: the service token is irrelevant here but required by Settings.
_LIVE_SERVICE_TOKEN = "eval-runner-live-token-not-a-secret"  # noqa: S105


class ReplayMissingError(Exception):
    """The pipeline called the model for a case that has no recorded response."""


class LiveModeRefusedError(Exception):
    """Live mode was requested where it must not run (CI, Gemini API dev mode)."""


def _is_generate_content(request: httpx.Request) -> bool:
    return request.method == "POST" and request.url.path.endswith(":generateContent")


class ReplayTransport(httpx.BaseTransport):
    def __init__(self, recording: Path) -> None:
        self._recording = recording
        self.calls = 0

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if not _is_generate_content(request):
            raise ReplayMissingError(f"unexpected request {request.method} {request.url.path}")
        if not self._recording.is_file():
            raise ReplayMissingError(f"no recorded model response at {self._recording}")
        body = self._recording.read_bytes()
        return httpx.Response(
            200, headers={"content-type": "application/json"}, content=body, request=request
        )


# Headers that describe the wire encoding; the recorded body is already decoded.
_HOP_HEADERS = frozenset({"content-encoding", "content-length", "transfer-encoding"})


class RecordingTransport(httpx.BaseTransport):
    """Forwards to ``inner`` and writes every successful ``generateContent`` body to ``target``."""

    def __init__(self, inner: httpx.BaseTransport, target: Path) -> None:
        self._inner = inner
        self._target = target
        self.recorded = False

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self._inner.handle_request(request)
        try:
            body = response.read()
        finally:
            response.close()
        if response.status_code == 200 and _is_generate_content(request):
            parsed = json.loads(body)
            self._target.write_text(
                json.dumps(parsed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            self.recorded = True
        headers = [
            (name, value)
            for name, value in response.headers.multi_items()
            if name.lower() not in _HOP_HEADERS
        ]
        return httpx.Response(
            response.status_code, headers=headers, content=body, request=request
        )

    def close(self) -> None:
        self._inner.close()


def _no_adc(**_: Any) -> Any:
    raise ModelClientInitError("replay mode never loads Google credentials")


def replay_model(recording: Path) -> ModelClient:
    settings = Settings.model_validate(_REPLAY_SETTINGS)
    return build_model_client(
        settings,
        credentials=Credentials(token=_REPLAY_TOKEN),
        httpx_client=httpx.Client(transport=ReplayTransport(recording)),
        credentials_loader=_no_adc,
    )


def live_settings(environ: Mapping[str, str]) -> Settings:
    """Vertex settings from the environment; refuses CI and the Gemini API free tier."""
    if environ.get("CI"):
        raise LiveModeRefusedError("--live never runs in CI (no credentials, no live evals)")
    # The constructor (unlike model_validate) reads VERTEX_* and AI_* from the environment.
    settings = Settings(ai_service_token=SecretStr(_LIVE_SERVICE_TOKEN))
    if settings.ai_allow_gemini_api_dev:
        raise LiveModeRefusedError("--live records Vertex AI only; unset AI_ALLOW_GEMINI_API_DEV")
    return settings


def live_model(
    settings: Settings,
    target: Path,
    *,
    inner: httpx.BaseTransport | None = None,
    credentials: Any | None = None,
) -> ModelClient:
    """A Vertex client whose responses are recorded to ``target``.

    ``inner`` and ``credentials`` exist for the unit test (a fake transport and a static token);
    in live use they are the SDK's normal HTTP transport and ADC.
    """
    client = httpx.Client(
        transport=RecordingTransport(inner or httpx.HTTPTransport(), target),
        timeout=settings.ai_model_timeout_seconds,
    )
    if credentials is None:
        return build_model_client(settings, httpx_client=client)
    return build_model_client(
        settings, credentials=credentials, httpx_client=client, credentials_loader=_no_adc
    )
