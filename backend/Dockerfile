FROM python:3.12-slim

WORKDIR /app

# Install uv
RUN pip install --no-cache-dir uv

# Copy and install dependencies
# NOTE: the build context is the REPO ROOT (see docker-compose.yml), not backend/, because the
# image needs shared/python — the scene-graph models the API validates against. With a
# backend/-only context those models are absent and any runtime import of them fails.
COPY backend/pyproject.toml .
RUN uv pip install --system -e ".[dev]"

# Copy app source
COPY backend/ .

# Shared cross-language definitions. PYTHONPATH=/app makes `shared.python.models` importable,
# matching how pytest resolves it via `pythonpath = [".."]`.
COPY shared/__init__.py /app/shared/__init__.py
COPY shared/python /app/shared/python
ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
