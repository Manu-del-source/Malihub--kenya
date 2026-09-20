"""Health endpoints.

The property being tested is not "does /health return 200" — it's the two
guarantees that make these endpoints safe to hand an orchestrator:

* liveness touches no dependency, so it keeps answering during an outage;
* readiness distinguishes "not configured" from "unreachable", and is strict
  about it in production.
"""

from __future__ import annotations

from typing import Any

import pytest


def test_liveness_reports_ok_without_any_dependency(client: Any) -> None:
    """No DATABASE_URL, no REDIS_URL — liveness is still 200.

    This is the whole point of splitting liveness from readiness. If this test
    ever needs a database to pass, the split has been undone and a Postgres
    blip will cause a restart storm.
    """
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["environment"] == "development"
    assert body["api_version"] == "v1"
    assert body["uptime_seconds"] >= 0
    # Liveness must not enumerate dependency state — that is /health/ready.
    assert "dependencies" not in body


def test_liveness_is_versioned_under_api_v1(client: Any) -> None:
    assert client.get("/health").status_code == 404
    assert client.get("/api/v1/health").status_code == 200


def test_readiness_reports_unconfigured_dependencies_in_development(client: Any) -> None:
    response = client.get("/api/v1/health/ready")
    # 200, not 503: local development without Redis is a normal state, and a
    # developer's instance should not be pulled out of rotation for it.
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["dependencies"]["database"]["state"] == "not_configured"
    assert body["dependencies"]["redis"]["state"] == "not_configured"


def test_readiness_exposes_no_connection_details(client: Any) -> None:
    """The endpoint is public; its body must be safe to publish."""
    body = client.get("/api/v1/health/ready").json()
    serialized = str(body).lower()
    for forbidden in ("postgres", "redis://", "rediss://", "asyncpg", "password", "supabase", "@"):
        assert forbidden not in serialized, f"readiness leaked {forbidden!r}: {body}"


@pytest.mark.parametrize(
    ("environment", "expected_status", "expected_http"),
    [
        ("development", "degraded", 200),
        ("staging", "degraded", 200),
        # Production refuses to report ready with no database: silently serving
        # traffic from an instance that cannot read or write is worse than
        # refusing it.
        ("production", "unavailable", 503),
    ],
)
def test_readiness_strictness_depends_on_environment(
    make_app: Any, environment: str, expected_status: str, expected_http: int
) -> None:
    """`not_configured` is tolerable in development and fatal in production.

    Uses a client that does NOT run the lifespan, so the readiness rule is
    tested in isolation from the startup validation that would (correctly)
    refuse to boot a production instance with no `DATABASE_URL` at all — that
    rule has its own test in `test_config.py`.
    """
    from fastapi.testclient import TestClient

    app = make_app(environment=environment)
    response = TestClient(app).get("/api/v1/health/ready")
    assert response.status_code == expected_http
    assert response.json()["status"] == expected_status


def test_health_endpoints_carry_request_id(client: Any) -> None:
    response = client.get("/api/v1/health")
    assert response.headers.get("x-request-id")
    assert len(response.headers["x-request-id"]) >= 8


def test_health_endpoints_set_security_headers(client: Any) -> None:
    headers = client.get("/api/v1/health").headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["cache-control"].startswith("no-store")
    assert headers["x-frame-options"] == "DENY"


def test_quiet_paths_are_not_access_logged_at_info(client: Any) -> None:
    """Health probes every few seconds must not bury the log.

    Attaches a handler to the `app.access` logger directly rather than using
    pytest's `caplog`: the app's lifespan calls `configure_logging(force=True)`,
    which clears the root logger's handlers, and relying on that ordering would
    make this test pass or fail depending on fixture setup order.
    """
    import logging

    captured: list[logging.LogRecord] = []

    class _Collector(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record)

    access_logger = logging.getLogger("app.access")
    collector = _Collector(level=logging.DEBUG)
    previous_level = access_logger.level
    access_logger.setLevel(logging.DEBUG)
    access_logger.addHandler(collector)
    try:
        client.get("/api/v1/health")
        client.get("/api/v1/health/ready")
    finally:
        access_logger.removeHandler(collector)
        access_logger.setLevel(previous_level)

    assert captured, "expected an access log record for the health probes"
    # Still emitted, but at DEBUG — available when someone is looking, invisible
    # at the default INFO level, so a 5-second probe interval doesn't produce
    # 17k lines a day of nothing.
    assert all(record.levelno < logging.INFO for record in captured)
    assert all(record.path in {"/api/v1/health", "/api/v1/health/ready"} for record in captured)
