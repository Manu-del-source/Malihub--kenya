"""Health endpoints.

Two, because they answer two different questions and conflating them causes
real outages:

  GET /api/v1/health        **liveness**  — "is this process alive?"
  GET /api/v1/health/ready  **readiness** — "can this instance serve traffic?"

Liveness touches *nothing*. No database, no Redis, no provider. If it queried
Postgres, a database blip would make every instance report "dead" and the
orchestrator would restart them all at once — turning a dependency outage into
an outage plus a restart storm plus a cold-cache stampede. Liveness answers
from memory and always returns 200 while the event loop can schedule a
coroutine.

Readiness checks the dependencies, with a hard timeout, and returns 503 when
the instance cannot do its job — which is how an orchestrator pulls it out of
rotation without killing it.

Both endpoints are unauthenticated and public. Everything in their responses is
therefore public information by construction: no DSN, no host, no version of a
dependency, no stack trace. A state, a latency, and at most a short
classification.
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime, timezone

from fastapi import APIRouter, Depends, Response

from app.core.config import Settings, get_settings
from app.core.db import get_database
from app.core.logging import get_logger
from app.core.redis import get_redis_gateway
from app.schemas.common import DependencyHealth, HealthResponse, ReadinessResponse

logger = get_logger(__name__)

router = APIRouter(tags=["health"])

#: Process start, for `uptime_seconds`. Monotonic: a wall-clock adjustment (NTP,
#: a DST bug, a VM migration) must not produce a negative uptime.
_STARTED_AT = time.monotonic()

#: Ceiling on a single dependency probe. A readiness check that hangs is worse
#: than one that fails: the orchestrator's own probe times out, and now
#: nothing — neither this service nor the caller — knows what state it's in.
_PROBE_TIMEOUT_SECONDS = 2.0

#: Dependencies whose failure makes an instance not ready.
_CRITICAL_DEPENDENCIES = ("database", "redis")


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness probe",
    description=(
        "Confirms the process is alive and serving. Touches no dependency, so "
        "it keeps answering during a database or Redis outage — which is the "
        "point. Use /health/ready to know whether the instance can do its job."
    ),
    responses={200: {"description": "The process is alive."}},
)
async def liveness(settings: Settings = Depends(get_settings)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        api_version=_api_version(settings),
        timestamp=datetime.now(UTC),
        uptime_seconds=round(time.monotonic() - _STARTED_AT, 3),
    )


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe",
    description=(
        "Checks the configured infrastructure dependencies and reports 503 when "
        "this instance cannot serve traffic. Returns no connection details — "
        "this endpoint is public."
    ),
    responses={
        200: {"description": "Ready, or degraded in a non-production environment."},
        503: {"description": "A critical dependency is unavailable."},
    },
)
async def readiness(
    response: Response,
    settings: Settings = Depends(get_settings),
) -> ReadinessResponse:
    checks = await asyncio.gather(
        _check_database(settings),
        _check_redis(settings),
        return_exceptions=True,
    )

    dependencies: dict[str, DependencyHealth] = {}
    for name, result in zip(_CRITICAL_DEPENDENCIES, checks, strict=True):
        if isinstance(result, BaseException):
            # `gather(return_exceptions=True)` should already have caught
            # everything the probes raise; this is the guard against a bug in a
            # probe taking down the endpoint that reports on it.
            logger.error(
                "health_probe_error",
                extra={
                    "event": "health_probe_error",
                    "dependency": name,
                    "error_type": type(result).__name__,
                },
            )
            result = DependencyHealth(state="unavailable", detail="probe_error")
        dependencies[name] = result

    status = _overall_status(dependencies, settings)
    if status != "ready":
        response.status_code = 503 if status == "unavailable" else 200

    payload = ReadinessResponse(
        status=status,
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        timestamp=datetime.now(UTC),
        dependencies=dependencies,
    )

    # A not-ready instance is worth one log line, but only once per distinct
    # state — a probe every five seconds must not produce a line every five
    # seconds, or the log has nothing else in it.
    if status != "ready":
        _log_state_change(status, dependencies)

    return payload


# ─── Dependency probes ───────────────────────────────────────────────────────


async def _check_database(settings: Settings) -> DependencyHealth:
    database = get_database()
    if not database.is_configured:
        return DependencyHealth(state="not_configured", detail="DATABASE_URL is not set")
    try:
        reachable, latency = await asyncio.wait_for(database.ping(), timeout=_PROBE_TIMEOUT_SECONDS)
    except TimeoutError:
        return DependencyHealth(state="unavailable", latency_ms=None, detail="probe_timeout")
    if not reachable:
        return DependencyHealth(state="unavailable", latency_ms=latency, detail="unreachable")
    return DependencyHealth(state="ok", latency_ms=latency)


async def _check_redis(settings: Settings) -> DependencyHealth:
    gateway = get_redis_gateway()
    if not gateway.is_configured:
        return DependencyHealth(state="not_configured", detail="REDIS_URL is not set")
    try:
        reachable, latency = await asyncio.wait_for(gateway.ping(), timeout=_PROBE_TIMEOUT_SECONDS)
    except TimeoutError:
        return DependencyHealth(state="unavailable", detail="probe_timeout")
    if not reachable:
        return DependencyHealth(state="unavailable", latency_ms=latency, detail="unreachable")
    return DependencyHealth(state="ok", latency_ms=latency)


# ─── Overall status ──────────────────────────────────────────────────────────


def _overall_status(dependencies: dict[str, DependencyHealth], settings: Settings) -> str:
    """`ready` | `degraded` | `unavailable`.

    * Any critical dependency `unavailable`  → `unavailable` (503).
    * A critical dependency `not_configured` → `unavailable` in production,
      `degraded` otherwise. Production refusing to serve with no database is
      the correct behaviour; local development without Redis is normal.
    * Everything ok                          → `ready`.
    """
    for name in _CRITICAL_DEPENDENCIES:
        health = dependencies.get(name)
        if health is None:
            continue
        if health.state == "unavailable":
            return "unavailable"
        if health.state == "not_configured":
            if settings.is_production:
                return "unavailable"
            return "degraded"
    return "ready"


_last_logged_state: str | None = None


def _log_state_change(status: str, dependencies: dict[str, DependencyHealth]) -> None:
    """Log a not-ready transition once, not once per probe."""
    global _last_logged_state
    fingerprint = f"{status}:{','.join(sorted(dependencies))}"
    if _last_logged_state == fingerprint:
        return
    _last_logged_state = fingerprint
    logger.warning(
        "readiness_not_ready",
        extra={
            "event": "readiness_not_ready",
            "status": status,
            # State names and latencies only — nothing identifying the hosts.
            "dependencies": {name: health.state for name, health in dependencies.items()},
        },
    )


def _api_version(settings: Settings) -> str:
    """`v1` from the configured prefix, so the two cannot disagree."""
    return settings.api_v1_prefix.rstrip("/").rsplit("/", 1)[-1] or "v1"


__all__ = ["router"]
