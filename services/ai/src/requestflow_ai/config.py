"""Service configuration from environment variables (no config files, no secrets in code).

There are deliberately no database or storage settings: the service is stateless (ADR-0001 D8).
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # hide_input_in_errors: a rejected value (e.g. a too-short token) must not reach startup logs.
    model_config = SettingsConfigDict(
        case_sensitive=False, extra="ignore", frozen=True, hide_input_in_errors=True
    )

    # Bearer token the TS worker sends. Required: the service refuses to start without it.
    ai_service_token: SecretStr = Field(min_length=24)

    # Vertex AI (Gemini Enterprise Agent Platform). Credentials: ADC / Workload Identity.
    vertex_project: str | None = None
    vertex_location: str = "eu"
    vertex_model: str = "gemini-3.5-flash"
    ai_model_timeout_seconds: float = Field(default=60, gt=0)

    # Gemini API (free tier) - local development with synthetic data only. Needs BOTH the flag
    # and the key; never used as a fallback for Vertex.
    ai_allow_gemini_api_dev: bool = False
    gemini_api_key: SecretStr | None = None

    ai_pdf_pipeline: Literal["textlines", "layout"] = "textlines"
    # OCR for PDF pages without a text layer (docling + RapidOCR). "auto" needs the layout and
    # RapidOCR models at startup (fail-closed); "off" leaves scanned pages empty.
    ai_pdf_ocr: Literal["off", "auto"] = "off"
    ai_max_document_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    ai_max_pdf_pages: int = Field(default=50, gt=0)
    ai_max_concurrent_extractions: int = Field(default=4, gt=0)
    ai_log_level: str = "INFO"
