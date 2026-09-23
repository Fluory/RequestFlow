# RequestFlow AI service - stateless, CPU only. Build: docker build -t requestflow-ai services/ai
# Not built in CI yet (unverified); see README "Verified vs. unverified".
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies first (cached layer), then the package itself. CPU-only torch comes from the lock.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

# Optional: bake the docling layout model into the image for AI_PDF_PIPELINE=layout
# (~164 MB). The default textlines pipeline needs no models.
ARG PREFETCH_LAYOUT_MODEL=false
ENV DOCLING_ARTIFACTS_PATH=/opt/docling-models
RUN if [ "$PREFETCH_LAYOUT_MODEL" = "true" ]; then \
      /app/.venv/bin/docling-tools models download layout -o /opt/docling-models; \
    else mkdir -p /opt/docling-models; fi

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001

# No runtime downloads: models are baked in or not used.
ENV PATH=/app/.venv/bin:$PATH \
    HF_HUB_OFFLINE=1

EXPOSE 8080
CMD ["uvicorn", "requestflow_ai.api.app:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8080", "--no-access-log", "--no-server-header"]
