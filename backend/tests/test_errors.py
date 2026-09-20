"""Structured error handling.

The contract under test: every non-2xx response has the same envelope, carries
a correlation id, and never leaks internals. The leak tests matter more than the
shape tests — an envelope nobody reads is a cosmetic problem, a DSN in a 500
body is an incident.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    RateLimitExceededError,
    ServiceUnavailableError,
    ValidationError,
)
from app.main import create_app
from tests.conftest import build_settings

#: Values that would be catastrophic to see in a response body. Synthetic, and
#: short enough that a repository secret scanner does not flag them as leaks.
SECRET_DSN = "postgresql://malihub:sup3r-s3cret@db.internal.example:5432/malihub"
SECRET_KEY = "sk_live_fake00000000"


@pytest.fixture
def error_app(make_app: Any) -> Any:
    """An app with routes that fail in each of the interesting ways.

    Added to the real app rather than a fresh one, so every test here exercises
    the production middleware stack, not a simplified copy of it.
    """
    app = make_app()

    @app.get("/test/not-found")
    async def not_found() -> None:
        raise NotFoundError("That order does not exist.")

    @app.get("/test/validation")
    async def validation() -> None:
        raise ValidationError("Bad input.", details={"fields": [{"field": "amount", "message": "too small"}]})

    @app.get("/test/conflict")
    async def conflict() -> None:
        raise ConflictError()

    @app.get("/test/forbidden")
    async def forbidden() -> None:
        raise ForbiddenError()

    @app.get("/test/rate-limited")
    async def rate_limited() -> None:
        raise RateLimitExceededError(retry_after_seconds=42)

    @app.get("/test/unavailable")
    async def unavailable() -> None:
        raise ServiceUnavailableError()

    @app.get("/test/unhandled")
    async def unhandled() -> str:
        # Deliberately embeds a DSN and an API key in the exception text: this
        # is exactly what a real driver error looks like, and exactly what must
        # not reach the client.
        raise RuntimeError(f"connection failed for {SECRET_DSN} using {SECRET_KEY}")

    @app.get("/test/query")
    async def needs_query(limit: int) -> dict[str, int]:
        return {"limit": limit}

    return app


@pytest.mark.parametrize(
    ("path", "expected_status", "expected_code"),
    [
        ("/test/not-found", 404, "not_found"),
        ("/test/validation", 422, "validation_error"),
        ("/test/conflict", 409, "conflict"),
        ("/test/forbidden", 403, "forbidden"),
        ("/test/rate-limited", 429, "rate_limit_exceeded"),
        ("/test/unavailable", 503, "service_unavailable"),
        ("/test/unhandled", 500, "internal_error"),
        ("/api/v1/does-not-exist", 404, "not_found"),
    ],
)
def test_every_error_uses_one_envelope(
    error_app: Any, path: str, expected_status: int, expected_code: str
) -> None:
    with TestClient(error_app, raise_server_exceptions=False) as client:
        response = client.get(path)
    assert response.status_code == expected_status
    body = response.json()

    assert set(body) == {"error"}, f"unexpected top-level keys: {body}"
    error = body["error"]
    assert error["code"] == expected_code
    assert isinstance(error["message"], str) and error["message"]
    assert "request_id" in error
    # Starlette's `{"detail": …}` shape must not survive anywhere.
    assert "detail" not in body


def test_request_id_matches_response_header(error_app: Any) -> None:
    with TestClient(error_app, raise_server_exceptions=False) as client:
        response = client.get("/test/not-found")
    header_id = response.headers["x-request-id"]
    assert response.json()["error"]["request_id"] == header_id


def test_unhandled_error_never_leaks_secrets(error_app: Any) -> None:
    """The most important assertion in this file."""
    with TestClient(error_app, raise_server_exceptions=False) as client:
        response = client.get("/test/unhandled")
    assert response.status_code == 500
    text = response.text
    assert SECRET_DSN not in text
    assert SECRET_KEY not in text
    assert "sup3r-s3cret" not in text
    assert "db.internal.example" not in text
    assert "Traceback" not in text
    # A generic message, and the correlation id so support can find the detail
    # in the log — which is where it belongs.
    assert response.json()["error"]["message"]


def test_unhandled_error_includes_detail_only_outside_production(make_app: Any) -> None:
    """Development gets the exception type; production never does."""
    dev_app = make_app(environment="development", debug=True)

    @dev_app.get("/test/boom")
    async def boom() -> None:
        raise ValueError("a development-only detail")

    with TestClient(dev_app, raise_server_exceptions=False) as client:
        details = client.get("/test/boom").json()["error"].get("details") or {}
    assert details.get("exception_type") == "ValueError"

    # A production app has to satisfy every startup requirement or it refuses
    # to boot (see test_config.py); the DSNs here are never connected to, since
    # the route under test doesn't touch them.
    production_app = create_app(
        build_settings(
            environment="production",
            debug=False,
            cors_origins="https://malihub.co.ke",
            enable_docs=False,
            backend_public_url="https://api.malihub.co.ke",
            supabase_jwt_secret="not-a-real-secret-0123456789abcdef0123456789",
            database_url="postgresql://u:p@127.0.0.1:1/malihub",
            redis_url="redis://127.0.0.1:1/0",
        )
    )

    @production_app.get("/test/boom")
    async def production_boom() -> None:
        raise ValueError("a development-only detail")

    with TestClient(production_app, raise_server_exceptions=False) as client:
        body = client.get("/test/boom").json()["error"]
    assert "details" not in body or body["details"] is None
    assert "development-only detail" not in str(body)
    assert "ValueError" not in str(body)


def test_validation_error_does_not_echo_the_offending_value(error_app: Any) -> None:
    """A rejected `password` or `phone_number` must not be reflected back.

    FastAPI's default 422 includes `ctx`/`input`, which for a secret field puts
    the secret in a response body and in whatever logs that body.
    """
    with TestClient(error_app, raise_server_exceptions=False) as client:
        response = client.get("/test/query?limit=not-a-number")
    assert response.status_code == 422
    body = response.json()
    fields = body["error"]["details"]["fields"]
    assert fields and fields[0]["field"].endswith("limit")
    assert "not-a-number" not in response.text
    for field in fields:
        assert set(field) <= {"field", "message", "type"}


def test_missing_required_query_uses_the_same_envelope(error_app: Any) -> None:
    with TestClient(error_app, raise_server_exceptions=False) as client:
        response = client.get("/test/query")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_rate_limit_error_sets_retry_after(error_app: Any) -> None:
    with TestClient(error_app, raise_server_exceptions=False) as client:
        response = client.get("/test/rate-limited")
    assert response.status_code == 429
    assert response.headers["retry-after"] == "42"
    assert response.json()["error"]["details"]["retry_after_seconds"] == 42


def test_error_responses_carry_cors_headers(make_app: Any) -> None:
    """A 401/429/500 without CORS headers is invisible to browser JavaScript.

    The fetch rejects as an opaque network error and the frontend cannot read
    `error.code` to show the right message. This is the property the middleware
    ordering in `app/main.py` exists to guarantee.
    """
    app = make_app(cors_origins="http://localhost:3000")

    @app.get("/test/boom")
    async def boom() -> None:
        raise RuntimeError("unhandled")

    headers = {"Origin": "http://localhost:3000"}
    with TestClient(app, raise_server_exceptions=False) as client:
        # Both paths: an ApiError handled by ExceptionMiddleware (inner) and an
        # unhandled exception caught by ExceptionGuardMiddleware (outer). Both
        # must come back through CORSMiddleware.
        handled = client.get("/api/v1/nope", headers=headers)
        unhandled = client.get("/test/boom", headers=headers)

    assert handled.status_code == 404
    assert handled.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert unhandled.status_code == 500
    assert unhandled.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_error_responses_are_not_cacheable(error_app: Any) -> None:
    """A 401 or 429 served from a shared cache is indistinguishable from fresh."""
    with TestClient(error_app, raise_server_exceptions=False) as client:
        response = client.get("/test/forbidden")
    assert "no-store" in response.headers["cache-control"]
