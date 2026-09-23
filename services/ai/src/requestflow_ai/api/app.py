"""FastAPI app. Run: ``uvicorn requestflow_ai.api.app:create_app --factory``.

Startup is fail-closed: missing ``AI_SERVICE_TOKEN`` (settings validation), a model client that
cannot be built or (with ``AI_PDF_PIPELINE=layout``) a missing layout model raises before the
server accepts requests.

``/v1/extract`` is guarded by a pure ASGI middleware (``ExtractGuard``) that checks the bearer token
and the declared ``Content-Length`` before a single body byte is read or spooled.
"""

from __future__ import annotations

import hmac
import logging
import re
import threading
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.security.utils import get_authorization_scheme_param
from starlette._utils import get_route_path
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from requestflow_ai.api.schemas import (
    ErrorCode,
    ErrorDetail,
    ErrorResponse,
    ExtractedFields,
    ExtractResponse,
    FieldResult,
    HealthResponse,
    RunMetadata,
    TokenUsage,
)
from requestflow_ai.config import Settings
from requestflow_ai.extraction.model_client import (
    ModelClient,
    ModelClientError,
    ModelOutputError,
    build_model_client,
)
from requestflow_ai.extraction.prompt import PROMPT_VERSION
from requestflow_ai.extraction.schema import SCHEMA_VERSION
from requestflow_ai.jsonlog import configure_logging, document_id_var, request_id_var
from requestflow_ai.parsing.errors import (
    DocumentParseError,
    DocumentTooLongError,
    UnsupportedMediaTypeError,
)
from requestflow_ai.parsing.pdf import prepare_pdf_pipeline
from requestflow_ai.pipeline import run_extraction

_log = logging.getLogger("requestflow_ai.api")

API_VERSION = "1.0.0"
EXTRACT_PATH = "/v1/extract"
# Multipart framing around the file: boundaries, part headers and the small form fields
# (documentId <= 128, mediaType <= 100 chars). The exact file limit is enforced after parsing.
MULTIPART_OVERHEAD_BYTES = 16 * 1024
_DIGITS = re.compile(r"[0-9]{1,20}")
ID_PATTERN = r"^[A-Za-z0-9._:-]{1,128}$"
_ID_RE = re.compile(ID_PATTERN)
_bearer = HTTPBearer(auto_error=False, scheme_name="bearerAuth")


class ApiError(Exception):
    status: int
    code: ErrorCode
    message: str

    def __init__(self, status: int, code: ErrorCode, message: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message


def _error_response(status: int, code: ErrorCode, message: str) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorDetail(code=code, message=message), request_id=request_id_var.get()
    )
    headers = {"WWW-Authenticate": "Bearer"} if status == 401 else None
    return JSONResponse(body.model_dump(by_alias=True), status_code=status, headers=headers)


def _error_doc(description: str) -> dict[str, object]:
    return {"model": ErrorResponse, "description": description}


_UNAUTHORIZED = (401, "unauthorized", "missing or invalid bearer token")


def _token_valid(token: str | None, settings: Settings) -> bool:
    expected = settings.ai_service_token.get_secret_value().encode()
    given = token.encode() if token else b""
    # compare_digest on bytes: constant time with respect to the content of the token.
    return bool(token) and hmac.compare_digest(given, expected)


def _bearer_token(authorization: str | None) -> str | None:
    scheme, token = get_authorization_scheme_param(authorization)
    return token if scheme.lower() == "bearer" and token else None


def require_token(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> None:
    # Defence in depth (and the contract's security scheme); ExtractGuard already checked it.
    settings: Settings = request.app.state.settings
    if not _token_valid(credentials.credentials if credentials else None, settings):
        raise ApiError(*_UNAUTHORIZED)


class ExtractGuard:
    """Pure ASGI middleware for ``/v1/extract``: runs before the body is read.

    1. No valid bearer token -> 401 (constant-time compare).
    2. Missing or non-numeric ``Content-Length`` (e.g. chunked uploads) -> 411.
    3. Declared length above ``AI_MAX_DOCUMENT_BYTES`` + ``MULTIPART_OVERHEAD_BYTES`` -> 413.

    The ASGI server enforces that the body is not longer than the declared length.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # get_route_path strips a proxy root_path (uvicorn --root-path), as the router does.
        if scope["type"] != "http" or get_route_path(scope) != EXTRACT_PATH:
            await self.app(scope, receive, send)
            return
        settings: Settings = scope["app"].state.settings
        headers = Headers(scope=scope)
        rejection: JSONResponse | None = None
        length = headers.get("content-length")
        if not _token_valid(_bearer_token(headers.get("authorization")), settings):
            rejection = _error_response(*_UNAUTHORIZED)
        elif length is None or not _DIGITS.fullmatch(length):
            rejection = _error_response(411, "length_required", "content-length header required")
        elif int(length) > settings.ai_max_document_bytes + MULTIPART_OVERHEAD_BYTES:
            rejection = _error_response(
                413,
                "document_too_large",
                f"document exceeds {settings.ai_max_document_bytes} bytes",
            )
        if rejection is not None:
            await rejection(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _read_limited(upload: UploadFile, limit: int) -> bytes:
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "document_too_large", f"document exceeds {limit} bytes")
    return data


def build_api() -> FastAPI:
    app = FastAPI(
        title="RequestFlow AI service",
        version=API_VERSION,
        summary="Stateless parse -> extract -> verify for quote requests (ADR-0001 D8).",
        openapi_url=None,  # the contract lives in contracts/ai-service.openapi.yaml
        docs_url=None,
        redoc_url=None,
    )
    # Added before request_context, so it runs inside it (request ID set, header added).
    app.add_middleware(ExtractGuard)

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if _ID_RE.match(incoming) else str(uuid.uuid4())
        request_token = request_id_var.set(request_id)
        document_token = document_id_var.set(None)
        started = time.perf_counter()
        try:
            try:
                response = await call_next(request)
            except Exception as exc:
                # Inside the request context, so the log line and the response carry the ID.
                _log.error("unhandled_error", exc_info=exc)
                response = _error_response(500, "internal_error", "internal error")
            response.headers["X-Request-Id"] = request_id
            _log.info(
                "request_completed",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "latencyMs": round((time.perf_counter() - started) * 1000),
                },
            )
            return response
        finally:
            request_id_var.reset(request_token)
            document_id_var.reset(document_token)

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
        return _error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Only field locations, never the rejected input (it may be document data).
        fields = sorted({str(err.get("loc", ["?"])[-1]) for err in exc.errors()})
        return _error_response(400, "invalid_request", f"invalid form fields: {', '.join(fields)}")

    @app.exception_handler(Exception)
    async def unexpected_handler(_: Request, exc: Exception) -> JSONResponse:
        # Last resort only: runs outside request_context, which normally catches first.
        _log.error("unhandled_error", exc_info=exc)
        return _error_response(500, "internal_error", "internal error")

    @app.get("/healthz", response_model=HealthResponse, operation_id="healthz", tags=["ops"])
    def healthz() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.post(
        "/v1/extract",
        response_model=ExtractResponse,
        operation_id="extract",
        tags=["extraction"],
        summary="Parse one document, extract header fields, verify every quote.",
        dependencies=[Depends(require_token)],
        responses={
            400: _error_doc("Invalid form fields."),
            401: _error_doc("Missing or invalid bearer token (checked before the body is read)."),
            411: _error_doc("Content-Length header missing or not a number."),
            413: _error_doc(
                "Document larger than AI_MAX_DOCUMENT_BYTES (declared Content-Length checked "
                "before the body is read, the file size after)."
            ),
            415: _error_doc("Not a PDF or RFC 5322 e-mail (.msg is not supported yet)."),
            422: _error_doc(
                "The document could not be parsed (`document_unparseable`) or has more pages "
                "than AI_MAX_PDF_PAGES (`document_too_long`)."
            ),
            429: _error_doc("All extraction slots busy; retry later."),
            500: _error_doc("Unexpected error."),
            502: _error_doc("The model call failed or returned invalid output; retry later."),
        },
    )
    def extract(
        request: Request,
        file: Annotated[UploadFile, File(description="The document bytes (PDF or .eml).")],
        document_id: Annotated[
            str,
            Form(
                alias="documentId",
                pattern=ID_PATTERN,
                description="Opaque ID from the caller; echoed and logged, never interpreted.",
            ),
        ],
        media_type: Annotated[
            str | None,
            Form(
                alias="mediaType",
                max_length=100,
                description="Declared media type, e.g. message/rfc822. PDF is detected from bytes.",
            ),
        ] = None,
        x_request_id: Annotated[
            str | None,
            Header(
                alias="X-Request-Id",
                description=(
                    "Correlation ID, echoed in the response header and body and in logs. Must "
                    f"match {ID_PATTERN}; otherwise the service generates one."
                ),
            ),
        ] = None,
    ) -> ExtractResponse:
        del x_request_id  # read by the request_context middleware; declared for the contract
        settings: Settings = request.app.state.settings
        model: ModelClient = request.app.state.model_client
        slots: threading.BoundedSemaphore = request.app.state.extraction_slots
        document_id_var.set(document_id)
        started = time.perf_counter()

        if not slots.acquire(blocking=False):
            raise ApiError(429, "busy", "all extraction slots are busy")
        try:
            data = _read_limited(file, settings.ai_max_document_bytes)
            run = run_extraction(
                data, media_type, model, settings.ai_pdf_pipeline, settings.ai_max_pdf_pages
            )
        except (
            UnsupportedMediaTypeError,
            DocumentParseError,
            DocumentTooLongError,
            ModelClientError,
            ApiError,
        ) as exc:
            error = _map_error(exc)
            _log.warning(
                "extraction_failed", extra={"errorCode": error.code, "status": error.status}
            )
            raise error from exc
        except Exception as exc:
            # Logged here, where the document ID is still in context (type name only).
            _log.error("unhandled_error", exc_info=exc)
            raise ApiError(500, "internal_error", "internal error") from exc
        finally:
            slots.release()

        latency_ms = round((time.perf_counter() - started) * 1000)
        _log.info(
            "extraction_completed",
            extra={
                "documentKind": run.document_kind,
                "segmentCount": len(run.segments),
                "modelId": run.model_id,
                "promptVersion": PROMPT_VERSION,
                "inputTokens": run.usage.input_tokens,
                "outputTokens": run.usage.output_tokens,
                "modelLatencyMs": run.model_latency_ms,
                "latencyMs": latency_ms,
                "fieldStatus": {key: field.status for key, field in run.fields.items()},
            },
        )
        return ExtractResponse(
            request_id=request_id_var.get() or "",
            document_id=document_id,
            document_kind=run.document_kind,
            segments=run.segments,
            fields=ExtractedFields(
                company=FieldResult.from_verified(run.fields["company"]),
                contact_person=FieldResult.from_verified(run.fields["contact_person"]),
                requested_delivery_date=FieldResult.from_verified(
                    run.fields["requested_delivery_date"]
                ),
            ),
            run=RunMetadata(
                model_id=run.model_id,
                model_version=run.model_version,
                prompt_version=PROMPT_VERSION,
                schema_version=SCHEMA_VERSION,
                pdf_pipeline=settings.ai_pdf_pipeline if run.document_kind == "pdf" else None,
                tokens=TokenUsage(
                    input_tokens=run.usage.input_tokens,
                    output_tokens=run.usage.output_tokens,
                    total_tokens=run.usage.total_tokens,
                ),
                latency_ms=latency_ms,
                model_latency_ms=run.model_latency_ms,
            ),
            warnings=run.warnings,
        )

    return app


def _map_error(exc: Exception) -> ApiError:
    if isinstance(exc, ApiError):
        return exc
    if isinstance(exc, UnsupportedMediaTypeError):
        return ApiError(415, "unsupported_media_type", "unsupported document type")
    if isinstance(exc, DocumentTooLongError):
        return ApiError(422, "document_too_long", "the document has too many pages")
    if isinstance(exc, DocumentParseError):
        return ApiError(422, "document_unparseable", "the document could not be parsed")
    if isinstance(exc, ModelOutputError):
        return ApiError(502, "model_output_invalid", "the model returned invalid output")
    return ApiError(502, "model_error", "the model call failed")


def create_app(
    settings: Settings | None = None, model_client: ModelClient | None = None
) -> FastAPI:
    settings = settings or Settings()  # type: ignore[call-arg]  # values come from the environment
    configure_logging(settings.ai_log_level)
    if model_client is None:
        model_client = build_model_client(settings)
    prepare_pdf_pipeline(settings.ai_pdf_pipeline)
    app = build_api()
    app.state.settings = settings
    app.state.model_client = model_client
    app.state.extraction_slots = threading.BoundedSemaphore(settings.ai_max_concurrent_extractions)
    _log.info("service_started", extra={"modelId": model_client.model_id})
    return app
