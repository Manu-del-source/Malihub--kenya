"""CORS configuration.

The rule under test is narrow and absolute: there is no configuration that
produces `Access-Control-Allow-Origin: *`. Not a default, not a fallback, not
an escape hatch — `Settings` rejects a literal `*` at parse time and refuses to
boot a production deployment with no explicit origin list.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient


def test_allowed_origin_is_reflected(make_app: Any) -> None:
    app = make_app(cors_origins="https://malihub.co.ke")
    with TestClient(app) as client:
        response = client.get("/api/v1/health", headers={"Origin": "https://malihub.co.ke"})
    assert response.headers["access-control-allow-origin"] == "https://malihub.co.ke"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_disallowed_origin_gets_no_cors_headers(make_app: Any) -> None:
    app = make_app(cors_origins="https://malihub.co.ke")
    with TestClient(app) as client:
        response = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})
    # The request still succeeds (CORS is enforced by the browser, not the
    # server) but without ACAO the browser refuses to hand the body to JS.
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") is None


def test_wildcard_is_never_emitted(make_app: Any) -> None:
    app = make_app(cors_origins="https://malihub.co.ke,https://app.malihub.co.ke")
    with TestClient(app) as client:
        for origin in ("https://malihub.co.ke", "https://app.malihub.co.ke", "https://evil.example", None):
            headers = {"Origin": origin} if origin else {}
            response = client.get("/api/v1/health", headers=headers)
            assert response.headers.get("access-control-allow-origin") != "*"


def test_multiple_origins_are_supported(make_app: Any) -> None:
    """Production is often two origins: the apex and a preview/staging host."""
    app = make_app(cors_origins="https://malihub.co.ke,https://staging.malihub.co.ke")
    with TestClient(app) as client:
        for origin in ("https://malihub.co.ke", "https://staging.malihub.co.ke"):
            response = client.get("/api/v1/health", headers={"Origin": origin})
            assert response.headers["access-control-allow-origin"] == origin


def test_preflight_allows_the_authorization_header(make_app: Any) -> None:
    """Without this the browser never sends the Supabase bearer token."""
    app = make_app(cors_origins="http://localhost:3000")
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/payments/providers",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type,x-request-id",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "Authorization" in response.headers["access-control-allow-headers"]
    assert "X-Request-ID" in response.headers["access-control-allow-headers"]
    assert int(response.headers["access-control-max-age"]) > 0


def test_preflight_is_rejected_for_a_disallowed_origin(make_app: Any) -> None:
    app = make_app(cors_origins="http://localhost:3000")
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/payments/providers",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert response.status_code == 400
    assert response.headers.get("access-control-allow-origin") is None


def test_request_id_is_exposed_to_javascript(make_app: Any) -> None:
    """`expose_headers` is what lets the frontend read it cross-origin.

    Without this the header is on the wire but invisible to `fetch`, so a user
    cannot quote a request id from a CORS request — which defeats the point of
    sending it.
    """
    app = make_app(cors_origins="http://localhost:3000")
    with TestClient(app) as client:
        response = client.get("/api/v1/health", headers={"Origin": "http://localhost:3000"})
    exposed = response.headers.get("access-control-expose-headers", "")
    assert "X-Request-ID" in exposed
    assert "Retry-After" in exposed


def test_origin_regex_supports_preview_deployments(make_app: Any) -> None:
    app = make_app(
        cors_origins="https://malihub.co.ke",
        cors_origin_regex=r"^https://malihub-[a-z0-9]+\.vercel\.app$",
    )
    with TestClient(app) as client:
        matched = client.get("/api/v1/health", headers={"Origin": "https://malihub-abc123.vercel.app"})
        unmatched = client.get("/api/v1/health", headers={"Origin": "https://malihub.evil.app"})
    assert matched.headers.get("access-control-allow-origin") == "https://malihub-abc123.vercel.app"
    assert unmatched.headers.get("access-control-allow-origin") is None


@pytest.mark.parametrize(
    "value",
    ["*", "https://a.example,*", "*", " , * , "],
)
def test_a_wildcard_origin_cannot_be_configured(value: str) -> None:
    from app.core.config import ConfigurationError
    from tests.conftest import build_settings

    with pytest.raises(ConfigurationError, match=r"must not contain '\*'"):
        build_settings(cors_origins=value)
