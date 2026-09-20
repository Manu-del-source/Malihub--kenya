"""Rate limiting.

Tested against an in-memory stand-in for Redis rather than a live server: what
matters is the limiter's decision logic and its failure behaviour, and both are
fully determined by what the gateway returns. A real-Redis variant is marked
`integration` and skipped unless `REDIS_URL` is set.
"""

from __future__ import annotations

import time
from typing import Any

import pytest

from app.core.errors import RateLimitExceededError
from app.core.redis import RedisGateway
from app.services.rate_limit import (
    BUCKETS,
    RateLimiter,
    _safe_identifier,
    request_identifier,
)
from tests.conftest import build_settings


class FakeRedisGateway:
    """In-memory `RedisGateway` stand-in with the same null-safe contract."""

    def __init__(self, *, configured: bool = True, failing: bool = False) -> None:
        self.is_configured = configured
        self.failing = failing
        self.windows: dict[str, list[int]] = {}

    def key(self, *parts: str) -> str:
        # Mirrors RedisGateway.key: the shared `malihub:` root plus the
        # backend's `api:` namespace.
        return ":".join(["malihub", "api", *parts])

    async def sliding_window_count(
        self, key: str, *, window_seconds: int, now_ms: int | None = None
    ) -> int | None:
        if self.failing:
            return None
        current = now_ms if now_ms is not None else int(time.time() * 1000)
        entries = [entry for entry in self.windows.get(key, []) if entry > current - window_seconds * 1000]
        entries.append(current)
        self.windows[key] = entries
        return len(entries)


def limiter(gateway: FakeRedisGateway, **overrides: Any) -> RateLimiter:
    return RateLimiter(gateway=gateway, settings=build_settings(**overrides))  # type: ignore[arg-type]


# ─── Bucket definitions ──────────────────────────────────────────────────────


def test_buckets_match_the_phase_7_frontend_limiter() -> None:
    """Same numbers as `src/lib/rate-limit.ts`.

    If the two stacks disagreed, a client could get a looser limit by arriving
    at the other tier — which makes the tighter one pointless.
    """
    expected = {
        "login": (8, 300),
        "signup": (5, 600),
        "password_reset": (5, 600),
        "listing_create": (10, 3600),
        "api": (120, 60),
    }
    for name, (limit, window) in expected.items():
        assert name in BUCKETS, name
        assert BUCKETS[name].limit == limit
        assert BUCKETS[name].window_seconds == window


def test_backend_only_buckets_are_documented_additions() -> None:
    """Surfaces the frontend does not have: a public capability endpoint and
    (in Phase 9) an unauthenticated provider webhook."""
    assert "payment_initiate" in BUCKETS
    assert "webhook" in BUCKETS


# ─── Decision logic ──────────────────────────────────────────────────────────


async def test_requests_under_the_limit_are_allowed() -> None:
    fake = FakeRedisGateway()
    service = limiter(fake)
    for _ in range(8):
        decision = await service.hit("login", "jane@example.com")
        assert decision.allowed
    assert decision.remaining == 0


async def test_the_request_over_the_limit_is_refused() -> None:
    fake = FakeRedisGateway()
    service = limiter(fake)
    for _ in range(BUCKETS["login"].limit):
        await service.hit("login", "jane@example.com")
    decision = await service.hit("login", "jane@example.com")
    assert not decision.allowed
    assert decision.remaining == 0


async def test_enforce_raises_429_with_retry_after() -> None:
    fake = FakeRedisGateway()
    service = limiter(fake)
    for _ in range(BUCKETS["signup"].limit):
        await service.enforce("signup", "1.2.3.4")
    with pytest.raises(RateLimitExceededError) as excinfo:
        await service.enforce("signup", "1.2.3.4")
    assert excinfo.value.status_code == 429
    assert excinfo.value.headers is not None
    assert int(excinfo.value.headers["Retry-After"]) >= 1


async def test_different_identifiers_have_separate_budgets() -> None:
    fake = FakeRedisGateway()
    service = limiter(fake)
    for _ in range(BUCKETS["login"].limit):
        await service.hit("login", "jane@example.com")
    assert (await service.hit("login", "jane@example.com")).allowed is False
    assert (await service.hit("login", "someone-else@example.com")).allowed is True


async def test_the_window_slides_rather_than_resetting() -> None:
    """A fixed window would let a client burst to 2× the limit across a
    boundary. This is the property that justifies a sorted set over a counter."""
    fake = FakeRedisGateway()
    service = limiter(fake)
    now = 1_000_000
    limit = BUCKETS["api"].limit
    for index in range(limit):
        await service.hit("api", "user:1", now_ms=now + index)
    assert (await service.hit("api", "user:1", now_ms=now + limit)).allowed is False
    # Well past the window: every earlier entry has aged out.
    assert (await service.hit("api", "user:1", now_ms=now + 61_000 + limit)).allowed is True


def test_decision_headers_are_emitted_for_allowed_requests_too() -> None:
    """A client that only learns its budget when it has exhausted it cannot back
    off gracefully."""
    from app.services.rate_limit import RateLimitDecision

    allowed = RateLimitDecision(True, limit=120, remaining=117, reset_seconds=60)
    assert allowed.headers == {
        "RateLimit-Limit": "120",
        "RateLimit-Remaining": "117",
        "RateLimit-Reset": "60",
    }

    refused = RateLimitDecision(False, limit=120, remaining=0, reset_seconds=42)
    assert refused.headers["Retry-After"] == "42"


# ─── Identifier handling ─────────────────────────────────────────────────────


def test_identifiers_are_case_folded() -> None:
    """`A@B.com` and `a@b.com` must share a bucket, or the limit is bypassed by
    varying case."""
    assert _safe_identifier("Jane@Example.COM") == _safe_identifier("jane@example.com")


def test_identifiers_are_length_capped() -> None:
    """A client must not be able to make us allocate unbounded Redis keys."""
    assert len(_safe_identifier("a" * 10_000)) <= 128


def test_empty_identifier_falls_back() -> None:
    assert _safe_identifier("   ") == "anonymous"


def test_redis_keys_are_namespaced_under_the_shared_root() -> None:
    """Both stacks share one Redis and one `malihub:` root without colliding:
    the frontend uses `malihub:ratelimit:*`, the backend `malihub:api:ratelimit:*`.
    """
    fake = FakeRedisGateway()
    key = fake.key("ratelimit", "v1", "login", "jane@example.com")
    assert key == "malihub:api:ratelimit:v1:login:jane@example.com"
    assert not key.startswith("malihub:ratelimit:")  # the frontend's namespace
    assert build_settings().redis_key("api", "ratelimit", "v1", "login") == key.rsplit(":", 1)[0]


def test_request_identifier_prefers_the_authenticated_user() -> None:
    """User-first because it is the identifier an attacker cannot rotate for
    free; IP is a weak fallback."""
    from starlette.requests import Request

    scope: dict[str, Any] = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [],
        "query_string": b"",
        "client": ("1.2.3.4", 5000),
        "state": {"user_id": "user-uuid-1"},
    }
    assert request_identifier(Request(scope)) == "user:user-uuid-1"

    del scope["state"]
    assert request_identifier(Request(scope)) == "ip:1.2.3.4"


# ─── Failure behaviour ───────────────────────────────────────────────────────


async def test_unconfigured_redis_fails_open() -> None:
    """The Phase 7 trade-off, preserved: a Redis outage degrades a protection
    rather than taking the whole API down."""
    service = limiter(FakeRedisGateway(configured=False))
    decision = await service.hit("login", "jane@example.com")
    assert decision.allowed
    assert decision.degraded


async def test_redis_errors_fail_open() -> None:
    service = limiter(FakeRedisGateway(failing=True))
    decision = await service.hit("login", "jane@example.com")
    assert decision.allowed
    assert decision.degraded


async def test_fail_closed_is_configurable() -> None:
    service = limiter(FakeRedisGateway(failing=True), rate_limit_fail_open=False)
    with pytest.raises(RateLimitExceededError):
        await service.enforce("login", "jane@example.com")


async def test_rate_limiting_can_be_disabled() -> None:
    service = limiter(FakeRedisGateway(), rate_limit_enabled=False)
    for _ in range(500):
        decision = await service.hit("login", "jane@example.com")
    assert decision.allowed
    assert not decision.degraded


# ─── Gateway null-safety ─────────────────────────────────────────────────────


async def test_gateway_operations_are_null_safe_when_unconfigured() -> None:
    """Mirrors `getRedis()` returning null in `src/lib/redis.ts`: no method may
    raise just because Redis isn't there."""
    gateway = RedisGateway(build_settings())
    assert gateway.is_configured is False
    assert gateway.client is None
    assert await gateway.get("malihub:api:x") is None
    assert await gateway.set("malihub:api:x", "1", ttl_seconds=60) is False
    assert await gateway.incr("malihub:api:x") is None
    assert await gateway.delete("malihub:api:x") is False
    assert await gateway.set_if_absent("malihub:api:x", "1", ttl_seconds=60) is False
    assert await gateway.sliding_window_count("malihub:api:x", window_seconds=60) is None
    assert await gateway.ping() == (False, None)


def test_gateway_requires_explicitly_when_a_caller_cannot_degrade() -> None:
    from app.core.redis import RedisUnavailableError

    gateway = RedisGateway(build_settings())
    with pytest.raises(RedisUnavailableError):
        gateway.require()


def test_dsn_host_is_logged_without_the_password() -> None:
    from app.core.redis import _redact_url

    assert _redact_url("rediss://default:r3dis-p4ss@eu1.upstash.io:6379") == "eu1.upstash.io:6379"
    assert "r3dis-p4ss" not in _redact_url("rediss://default:r3dis-p4ss@eu1.upstash.io:6379")
