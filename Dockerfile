# ---------- Stage 1: build the frontend ----------
COPY data/prepared/ data/prepared/
FROM node:20-alpine AS frontend-build
WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build
# result: /frontend/dist

# ---------- Stage 2: Python runtime ----------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# Dependencies first, so Docker can cache this layer
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

# Application code
COPY backend/ backend/

# Built frontend, served by the backend under /
COPY --from=frontend-build /frontend/dist frontend/dist

# Run as a non-root user
RUN useradd --create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8080

# Secrets (EARTHDATA_TOKEN) are passed at runtime, never baked into the image
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT}"]
