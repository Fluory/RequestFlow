"""Gemini on Vertex through the real google-genai SDK, replayed at the HTTP boundary."""

from __future__ import annotations

from typing import Any

import pytest
from conftest import Replay, fake_credentials, make_settings, no_adc, recorded
from google.auth.exceptions import DefaultCredentialsError

from requestflow_ai.extraction.model_client import (
    GeminiModelClient,
    ModelClientError,
    ModelClientInitError,
    ModelOutputError,
    build_model_client,
)

VERTEX_EU_URL = (
    "https://aiplatform.eu.rep.googleapis.com/v1beta1/projects/rf-synthetic-project/"
    "locations/eu/publishers/google/models/gemini-3.5-flash:generateContent"
)


def vertex_client(replay: Replay, **overrides: Any) -> GeminiModelClient:
    client = build_model_client(
        make_settings(**overrides),
        credentials=fake_credentials(),
        httpx_client=replay.client(),
        credentials_loader=no_adc,
    )
    assert isinstance(client, GeminiModelClient)
    return client


def test_vertex_eu_request_shape_and_parsed_response() -> None:
    replay = Replay(body=recorded("musterbau_pdf.json"))
    client = vertex_client(replay)

    response = client.extract("SYSTEM", "USER CONTENT")

    request = replay.requests[0]
    assert str(request.url) == VERTEX_EU_URL
    assert request.headers["authorization"] == "Bearer fake-access-token"
    sent = replay.request_json()
    assert sent["systemInstruction"]["parts"][0]["text"] == "SYSTEM"
    assert sent["contents"][0]["parts"][0]["text"] == "USER CONTENT"
    config = sent["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["temperature"] == 0
    schema = config["responseSchema"]
    assert set(schema["properties"]) == {
        "company",
        "contact_person",
        "email",
        "phone",
        "requested_delivery_date",
        "additional_requirements",
        "line_items",
    }
    assert schema["properties"]["line_items"]["type"].lower() == "array"
    # The model may not return "unverified": only the verifier sets it.
    assert "unverified" not in str(schema)
    assert "tools" not in sent

    assert client.model_id == "gemini-3.5-flash"
    assert response.extraction.company.value == "Musterbau Beispiel GmbH"
    assert response.usage.input_tokens == 612
    assert response.usage.output_tokens == 141
    assert response.usage.total_tokens == 753
    assert response.model_version == "gemini-3.5-flash"


def test_model_and_location_come_from_configuration() -> None:
    replay = Replay(body=recorded("musterbau_pdf.json"))
    client = vertex_client(replay, vertex_location="europe-west3", vertex_model="gemini-x-test")
    client.extract("S", "U")
    assert str(replay.requests[0].url) == (
        "https://europe-west3-aiplatform.googleapis.com/v1beta1/projects/rf-synthetic-project/"
        "locations/europe-west3/publishers/google/models/gemini-x-test:generateContent"
    )


def test_api_key_in_environment_does_not_switch_vertex_to_key_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-key-must-not-be-used")
    monkeypatch.setenv("GOOGLE_API_KEY", "synthetic-key-must-not-be-used")
    replay = Replay(body=recorded("musterbau_pdf.json"))
    vertex_client(replay).extract("S", "U")
    request = replay.requests[0]
    assert str(request.url) == VERTEX_EU_URL
    assert "x-goog-api-key" not in request.headers
    assert "synthetic-key" not in str(request.url)


def test_missing_vertex_project_fails_closed() -> None:
    with pytest.raises(ModelClientInitError, match="VERTEX_PROJECT"):
        build_model_client(make_settings(vertex_project=None), credentials_loader=no_adc)


def test_missing_credentials_fail_closed_at_startup() -> None:
    def failing_loader(**_: Any) -> Any:
        raise DefaultCredentialsError("no ADC in test")

    with pytest.raises(ModelClientInitError, match="credentials"):
        build_model_client(make_settings(), credentials_loader=failing_loader)


def test_gemini_api_key_alone_is_not_enough() -> None:
    # A key without the explicit dev flag never enables the free tier, and never replaces Vertex.
    with pytest.raises(ModelClientInitError, match="VERTEX_PROJECT"):
        build_model_client(
            make_settings(vertex_project=None, gemini_api_key="synthetic-key"),
            credentials_loader=no_adc,
        )


def test_dev_flag_without_key_fails_closed() -> None:
    with pytest.raises(ModelClientInitError, match="GEMINI_API_KEY"):
        build_model_client(
            make_settings(ai_allow_gemini_api_dev=True, vertex_project=None),
            credentials_loader=no_adc,
        )


@pytest.mark.parametrize("gemini_api_key", [None, "synthetic-dev-key"])
def test_dev_flag_together_with_vertex_project_fails_closed(gemini_api_key: str | None) -> None:
    # Ambiguous: a deployment (VERTEX_PROJECT set) must never silently run on the free tier.
    replay = Replay(body=recorded("musterbau_pdf.json"))
    with pytest.raises(ModelClientInitError, match="VERTEX_PROJECT"):
        build_model_client(
            make_settings(ai_allow_gemini_api_dev=True, gemini_api_key=gemini_api_key),
            credentials=fake_credentials(),
            httpx_client=replay.client(),
            credentials_loader=no_adc,
        )
    assert replay.requests == []


def test_dev_flag_with_key_uses_gemini_api_explicitly() -> None:
    replay = Replay(body=recorded("musterbau_pdf.json"))
    client = build_model_client(
        make_settings(
            ai_allow_gemini_api_dev=True, gemini_api_key="synthetic-dev-key", vertex_project=None
        ),
        httpx_client=replay.client(),
        credentials_loader=no_adc,
    )
    client.extract("S", "U")
    request = replay.requests[0]
    assert request.url.host == "generativelanguage.googleapis.com"
    assert request.headers["x-goog-api-key"] == "synthetic-dev-key"


def test_upstream_error_raises_model_client_error() -> None:
    replay = Replay(status=500, body={"error": {"code": 500, "message": "synthetic"}})
    with pytest.raises(ModelClientError):
        vertex_client(replay).extract("S", "U")


@pytest.mark.parametrize("text", ["not json", '{"company": {"value": "X"}}', '{"company": null}'])
def test_output_not_matching_schema_raises_model_output_error(text: str) -> None:
    body = recorded("musterbau_pdf.json")
    body["candidates"][0]["content"]["parts"][0]["text"] = text
    with pytest.raises(ModelOutputError):
        vertex_client(Replay(body=body)).extract("S", "U")


def test_model_status_unverified_is_rejected_as_invalid_output() -> None:
    body = recorded("musterbau_pdf.json")
    part = body["candidates"][0]["content"]["parts"][0]
    part["text"] = part["text"].replace('"status": "found"', '"status": "unverified"', 1)
    with pytest.raises(ModelOutputError):
        vertex_client(Replay(body=body)).extract("S", "U")
