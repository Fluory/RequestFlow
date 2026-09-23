"""The model behind a small protocol, and its Gemini (Vertex AI) implementation.

Fail-closed: any configuration or credential problem raises ``ModelClientInitError`` at startup.
There is no mock or fallback path in production code.

Vertex endpoint (verified in google-genai 2.25.0 source, ``_api_client.py``): with
``vertexai=True`` and ``location`` in ``_MULTI_REGIONAL_LOCATIONS = {"us", "eu"}`` the SDK uses
``https://aiplatform.{location}.rep.googleapis.com/`` (API version ``v1beta1``); a regional
location such as ``europe-west3`` uses ``https://{location}-aiplatform.googleapis.com/``.
No custom ``base_url`` is needed for ``eu``.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

import google.auth
import httpx
from google.auth.exceptions import GoogleAuthError
from google.genai import Client, errors, types
from pydantic import ValidationError

from requestflow_ai.config import Settings
from requestflow_ai.extraction.schema import ModelExtraction

_log = logging.getLogger(__name__)
_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"


class ModelClientInitError(Exception):
    """The model client cannot be created. The service must not start."""


class ModelClientError(Exception):
    """The model call failed (network, quota, upstream error)."""


class ModelOutputError(ModelClientError):
    """The model answered, but not with JSON matching the schema."""


@dataclass(frozen=True)
class ModelUsage:
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None


@dataclass(frozen=True)
class ModelResponse:
    extraction: ModelExtraction
    usage: ModelUsage
    model_version: str | None


class ModelClient(Protocol):
    @property
    def model_id(self) -> str: ...

    def extract(self, system_instruction: str, user_content: str) -> ModelResponse: ...


class GeminiModelClient:
    def __init__(self, client: Client, model: str) -> None:
        self._client = client
        self._model = model

    @property
    def model_id(self) -> str:
        return self._model

    def extract(self, system_instruction: str, user_content: str) -> ModelResponse:
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=ModelExtraction,
            temperature=0,
            candidate_count=1,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        try:
            response = self._client.models.generate_content(
                model=self._model, contents=user_content, config=config
            )
        except (errors.APIError, httpx.HTTPError, GoogleAuthError) as exc:
            raise ModelClientError(type(exc).__name__) from exc

        text = response.text
        if not text:
            raise ModelOutputError("empty model output")
        try:
            extraction = ModelExtraction.model_validate_json(text)
        except ValidationError as exc:
            # Never put the validation message in the error: it echoes model output (document data).
            raise ModelOutputError("model output does not match the schema") from exc

        usage = response.usage_metadata
        return ModelResponse(
            extraction=extraction,
            usage=ModelUsage(
                input_tokens=usage.prompt_token_count if usage else None,
                output_tokens=usage.candidates_token_count if usage else None,
                total_tokens=usage.total_token_count if usage else None,
            ),
            model_version=response.model_version,
        )


CredentialsLoader = Callable[..., tuple[Any, str | None]]


def build_model_client(
    settings: Settings,
    *,
    credentials: Any | None = None,
    httpx_client: httpx.Client | None = None,
    credentials_loader: CredentialsLoader = google.auth.default,
) -> ModelClient:
    """Create the configured model client or raise ``ModelClientInitError`` (fail-closed)."""
    http_options = types.HttpOptions(
        timeout=int(settings.ai_model_timeout_seconds * 1000),
        httpx_client=httpx_client,
    )

    if settings.ai_allow_gemini_api_dev and settings.vertex_project:
        # Ambiguous configuration: a deployment must never silently run on the free tier.
        raise ModelClientInitError(
            "AI_ALLOW_GEMINI_API_DEV=true and VERTEX_PROJECT are both set; refusing to start"
        )

    if settings.ai_allow_gemini_api_dev:
        key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
        if not key:
            raise ModelClientInitError(
                "AI_ALLOW_GEMINI_API_DEV=true requires GEMINI_API_KEY (no fallback)"
            )
        _log.warning(
            "gemini_api_dev_mode_enabled",
            extra={"modelId": settings.vertex_model, "note": "synthetic data only"},
        )
        try:
            client = Client(vertexai=False, api_key=key, http_options=http_options)
        except Exception as exc:
            raise ModelClientInitError("Gemini API client init failed") from exc
        return GeminiModelClient(client, settings.vertex_model)

    if not settings.vertex_project:
        raise ModelClientInitError(
            "VERTEX_PROJECT is required (Vertex AI is the only production path)"
        )

    if credentials is None:
        try:
            credentials, _ = credentials_loader(scopes=[_CLOUD_PLATFORM_SCOPE])
        except GoogleAuthError as exc:
            raise ModelClientInitError("Google Cloud credentials not available (ADC/WIF)") from exc

    try:
        client = Client(
            vertexai=True,
            project=settings.vertex_project,
            location=settings.vertex_location,
            credentials=credentials,
            http_options=http_options,
        )
    except Exception as exc:
        raise ModelClientInitError("Vertex AI client init failed") from exc

    # Defence in depth: an API key from the environment must never switch Vertex to key mode.
    if not client.vertexai or getattr(client._api_client, "api_key", None):
        raise ModelClientInitError("Vertex AI client resolved to API-key mode; refusing to start")
    return GeminiModelClient(client, settings.vertex_model)
