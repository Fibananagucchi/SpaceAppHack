# One container for architecture A: FastAPI backend + built frontend (static files).
# Built by Cloud Build with `gcloud run deploy --source .` (no local Docker required).

# ---- Stage 1: frontend build (skipped gracefully until frontend/package.json exists) ----
FROM node:24.15.0-alpine AS frontend
WORKDIR /frontend
COPY frontend/ ./
RUN if [ -f package.json ]; then \
        npm ci && npm run build; \
    else \
        echo "No frontend/package.json yet: building backend-only image"; \
        mkdir -p dist; \
    fi

# ---- Stage 2: Python runtime ----
FROM python:3.12.8-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ backend/
COPY data/prepared/ prepared/
COPY --from=frontend /frontend/dist/ frontend_dist/

# Runtime paths. On Cloud Run, DATA_DIR is overridden to the mounted Cloud Storage bucket
# and STATE_DB lives on the instance's temporary filesystem.
ENV APP_LOAD_DOTENV=0 \
    DATA_DIR=/app/data \
    RAW_DIR=/app/data/raw \
    STATE_DB=/tmp/state.sqlite \
    FRONTEND_DIST=/app/frontend_dist \
    PORT=8080

RUN useradd --uid 10001 --create-home appuser && mkdir -p /app/data && chown -R appuser /app/data
USER appuser

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
