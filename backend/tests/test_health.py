"""Smoke test for the health endpoint."""
import os

import pytest
from httpx import ASGITransport, AsyncClient

# `app.config` validates its settings when it is imported, so a minimal environment has to
# exist first. That is why the `app.main` import below deliberately sits after this code.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("BYOK_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")

from app.main import app  # noqa: E402


@pytest.mark.asyncio
async def test_health() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
