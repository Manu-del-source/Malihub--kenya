"""Test fixtures.

Every test builds its app from an explicit, minimal environment. Two reasons
that matters more here than in most suites:

* `Settings()` reads `.env` from the working directory. A developer's real
  `backend/.env` — with a real Supabase JWT secret, a real Postgres DSN — would
  otherwise change what the tests assert, and could put a live credential in a
  test log.
* This backend caches process-wide singletons (settings, database, Redis,
  provider registry, token verifier). Without a reset between cases, one test's
  configuration silently becomes the next test's.

So: `_env_file=None`, a fixed `BASE_ENV`, and `reset_singletons()` before every
app is built.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, reset_settings
from app.core.db import reset_database
from app.core.redis import reset_redis_gateway
from app.core.security import reset_token_verifier
from app.providers.payments.registry import reset_payment_registry
from app.services.email_service import reset_email_service
from app.services.payment_service import reset_payment_service
from app.services.rate_limit import reset_rate_limiter
from app.services.storage_service import reset_storage_service

#: The complete environment every test starts from. Anything not listed here is
#: unset, which is the point: a test that cares about Redis sets REDIS_URL and
#: can be sure nothing else is configured behind its back.
BASE_ENV: dict[str, str] = {
    "ENVIRONMENT": "development",
    "DEBUG": "false",
    "LOG_LEVEL": "WARNING",
    "LOG_FORMAT": "json",
    "APP_NAME": "MaliHub Kenya API (test)",
    "APP_VERSION": "0.8.0",
    "API_V1_PREFIX": "/api/v1",
    "CORS_ORIGINS": "http://localhost:3000",
    "CORS_ALLOW_CREDENTIALS": "true",
    "ENABLE_DOCS": "false",
    "DATABASE_ECHO": "false",
    "BACKEND_PUBLIC_URL": "http://localhost:8000",
    "FRONTEND_URL": "http://localhost:3000",
    # Explicitly absent by default:
    "DATABASE_URL": "",
    "REDIS_URL": "",
    "SUPABASE_URL": "",
    "SUPABASE_JWT_SECRET": "",
    "RESEND_API_KEY": "",
    "CLOUDINARY_CLOUD_NAME": "",
    "PAYHERO_ENABLED": "false",
    "PAYHERO_API_USERNAME": "",
    "PAYHERO_API_PASSWORD": "",
    "PAYHERO_CHANNEL_ID": "",
}


def reset_singletons() -> None:
    """Drop every cached process-wide object and the settings cache."""
    reset_database()
    reset_redis_gateway()
    reset_payment_registry()
    reset_payment_service()
    reset_storage_service()
    reset_email_service()
    reset_rate_limiter()
    reset_token_verifier()
    reset_settings()


def build_settings(**overrides: Any) -> Settings:
    """Construct `Settings` from `BASE_ENV` + overrides, ignoring any `.env`.

    Every field the model declares is cleared from the environment first, so a
    developer's real `backend/.env` (or a variable exported by CI) cannot leak a
    credential or a URL into a test that never asked for one.
    """
    for field_name in Settings.model_fields:
        os.environ.pop(field_name.upper(), None)

    environment = {**BASE_ENV, **{key.upper(): _stringify(value) for key, value in overrides.items()}}
    for key, value in environment.items():
        if value == "":
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    return Settings(_env_file=None)


def _stringify(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ",".join(str(item) for item in value)
    return str(value)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Restore the process environment and the singletons after every test."""
    original = dict(os.environ)
    reset_singletons()
    try:
        yield
    finally:
        os.environ.clear()
        os.environ.update(original)
        reset_singletons()


@pytest.fixture
def make_settings() -> Any:
    return build_settings


@pytest.fixture
def make_app() -> Any:
    """Build a `FastAPI` app from `BASE_ENV` + overrides."""
    from app.main import create_app

    def _make(**overrides: Any) -> FastAPI:
        settings = build_settings(**overrides)
        # `create_app` primes the process-wide cache, so route-level
        # `Depends(get_settings)` resolves to exactly this object.
        return create_app(settings)

    return _make


@pytest.fixture
def client(make_app: Any) -> Any:
    """A `TestClient` for a default development app (no DB, no Redis, no auth)."""
    app = make_app()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def bare_client(make_app: Any) -> Any:
    """A client that does NOT run the lifespan.

    For tests that assert behaviour during a broken startup, or that don't want
    the startup configuration warnings in the way.
    """
    return TestClient(make_app())
