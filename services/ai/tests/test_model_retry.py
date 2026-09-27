"""Transient model errors are retried inside one extraction call (#69), replayed at the HTTP boundary."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from conftest import fake_credentials, make_settings, no_adc, recorded

from requestflow_ai.extraction.model_client import ModelClientError, build_model_client

FAST = {"ai_model_retry_initial_delay_seconds": 0.01}


def _error(status: int) -> dict[str, Any]:
    return {"error": {"code": status, "message": "synthetic upstream error", "status": "UNAVAILABLE"}}


class Sequence:
    """Answers with the given (status, body) pairs in order; the last pair repeats."""

    def __init__(self, *responses: tuple[int, dict[str, Any]]) -> None:
        self._responses = list(responses)
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body = self._responses.pop(0) if len(self._responses) > 1 else self._responses[0]
        return httpx.Response(status, json=body)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


def _vertex(sequence: Sequence, **overrides: Any):  # noqa: ANN202 - returns the SDK-backed client
    return build_model_client(
        make_settings(**FAST, **overrides),
        credentials=fake_credentials(),
        httpx_client=sequence.client(),
        credentials_loader=no_adc,
    )


def test_a_503_is_retried_and_the_call_succeeds() -> None:
    sequence = Sequence((503, _error(503)), (200, recorded("musterbau_pdf.json")))

    _vertex(sequence).extract("S", "U")

    assert len(sequence.requests) == 2


def test_a_429_is_retried() -> None:
    sequence = Sequence((429, _error(429)), (200, recorded("musterbau_pdf.json")))

    _vertex(sequence).extract("S", "U")

    assert len(sequence.requests) == 2


def test_a_persistent_503_gives_up_after_three_attempts() -> None:
    sequence = Sequence((503, _error(503)))

    with pytest.raises(ModelClientError):
        _vertex(sequence).extract("S", "U")

    assert len(sequence.requests) == 3


@pytest.mark.parametrize("status", [400, 401, 403, 404, 500])
def test_other_errors_are_not_retried(status: int) -> None:
    sequence = Sequence((status, _error(status)))

    with pytest.raises(ModelClientError):
        _vertex(sequence).extract("S", "U")

    assert len(sequence.requests) == 1


def test_the_gemini_api_dev_path_retries_too() -> None:
    sequence = Sequence((503, _error(503)), (200, recorded("musterbau_pdf.json")))
    client = build_model_client(
        make_settings(
            **FAST, ai_allow_gemini_api_dev=True, gemini_api_key="synthetic-dev-key", vertex_project=None
        ),
        httpx_client=sequence.client(),
        credentials_loader=no_adc,
    )

    client.extract("S", "U")

    assert len(sequence.requests) == 2
