"""Response schemas shared across the API.

These are the *outbound* contract. Inbound validation for a domain lives next
to that domain (`schemas/payment.py`), because a request model carries
constraints that only make sense for that resource, while these carry the
shapes every endpoint agrees on: the error envelope and the health payload.

Field naming: snake_case on the wire, everywhere. The Prisma/TypeScript side of
this project is camelCase, and the two will meet in the frontend's API client.
Pick one per side and convert at the boundary — `src/lib/mappers.ts` already
does exactly that for the Next.js route handlers. Do not "fix" one side to
match the other in a schema; fix it in the mapper.
"""

from __future__ import annotations

from datetime import UTC, datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

DependencyState = Literal["ok", "unavailable", "not_configured", "skipped"]


class ErrorDetail(BaseModel):
    """The `error` object. The only error shape this API produces.

    Rendered by `core/errors.py`; declared here so it appears in the OpenAPI
    schema and a client can generate a type for it.
    """

    model_config = ConfigDict(extra="forbid")

    #: Stable, machine-readable, snake_case. A contract: adding is fine,
    #: renaming or removing is a breaking change.
    code: str = Field(examples=["not_found", "rate_limit_exceeded"])
    #: Safe to show a human. Never a stack trace, never a secret, never an
    #: exception message from an unhandled error.
    message: str
    #: Optional structured detail (e.g. per-field validation failures).
    details: dict[str, Any] | None = None
    #: Correlation handle. Also sent as the `X-Request-ID` response header, and
    #: what a user quotes when reporting a problem.
    request_id: str | None = None


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorDetail


class DependencyHealth(BaseModel):
    """One infrastructure dependency's readiness, as reported by /health/ready.

    Reports a state and a latency, and nothing else. No DSN, no host, no
    version string: this endpoint is unauthenticated and reachable from the
    internet, so everything in it is public information by construction.
    """

    model_config = ConfigDict(extra="forbid")

    state: DependencyState
    latency_ms: float | None = Field(default=None, ge=0)
    #: Present only when `state` is not `ok`, and only ever a short, non-secret
    #: classification.
    detail: str | None = None


class HealthResponse(BaseModel):
    """`GET /api/v1/health` — liveness. "Is this process alive and serving?"

    Answers yes without touching a single dependency, on purpose: a liveness
    probe that queries Postgres causes the orchestrator to restart a healthy
    process during a database blip, converting an outage into an outage plus a
    restart storm. Dependency state is `/health/ready`'s job.
    """

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    service: str
    version: str
    environment: str
    #: Which API version this build serves. A client that can read this can
    #: detect a deployment that predates the endpoint it wants.
    api_version: str = "v1"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    uptime_seconds: float = Field(ge=0)


class ReadinessResponse(BaseModel):
    """`GET /api/v1/health/ready` — readiness. "Can this instance do its job?"

    Returns 200 when ready, 503 when not, so an orchestrator can pull an
    unhealthy instance out of rotation without killing it. Dependencies that
    are configured but unreachable make the service *not ready*; dependencies
    that are not configured at all are reported as `not_configured` and, in
    production, also make it not ready — silently running a production
    instance with no database is worse than refusing traffic.
    """

    model_config = ConfigDict(extra="forbid")

    status: Literal["ready", "degraded", "unavailable"]
    service: str
    version: str
    environment: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    dependencies: dict[str, DependencyHealth]


class ServiceInfo(BaseModel):
    """`GET /` — the smallest useful answer for someone who finds the root URL."""

    model_config = ConfigDict(extra="forbid")

    service: str
    version: str
    environment: str
    api_version: str
    documentation_url: str | None = None
    health_url: str


class ApiV1Index(BaseModel):
    """`GET /api/v1` — discoverability for the versioned surface."""

    model_config = ConfigDict(extra="forbid")

    api_version: Literal["v1"] = "v1"
    service: str
    version: str
    endpoints: dict[str, str]


class PaginatedMeta(BaseModel):
    """Pagination envelope for list endpoints added in later phases.

    Declared now, unused in Phase 8, because a list endpoint added later
    shouldn't have to invent its pagination shape — and because the frontend's
    `PaginatedResult<T>` in `src/types/index.ts` already fixes the cursor-based
    convention this matches.
    """

    model_config = ConfigDict(extra="forbid")

    next_cursor: str | None = None
    has_more: bool = False
    total: int | None = Field(default=None, ge=0)


__all__ = [
    "ApiV1Index",
    "DependencyHealth",
    "DependencyState",
    "ErrorDetail",
    "ErrorResponse",
    "HealthResponse",
    "PaginatedMeta",
    "ReadinessResponse",
    "ServiceInfo",
]
