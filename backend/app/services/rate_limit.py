"""Redis-backed rate limiting.

Mirrors the Phase 7 limiter in `src/lib/rate-limit.ts` rather than replacing it.
Both stacks keep their own client (`@upstash/ratelimit` cannot run in Python)
but point at the same Redis and follow the same two policies:

* **Same buckets, same limits.** `BUCKETS` below duplicates the frontend's
  numbers — 8 login attempts / 5 min, 120 API requests / min, and so on — so a
  client cannot get a looser limit by arriving at a different tier. The bucket
  *keys* are namespaced separately (`malihub:api:ratelimit:…` vs
  `malihub:ratelimit:…`) because the two libraries lay out their sorted sets
  differently; sharing a key would corrupt both counters. Unifying the counters
  across stacks is a deliberate Phase 9+ decision, not an oversight.
* **Fail open, loudly.** When Redis is unavailable the request is allowed and a
  warning is logged. This is the same availability trade-off Phase 7 documented
  and it is configurable (`RATE_LIMIT_FAIL_OPEN=false` fails closed instead).
  The reasoning: an Upstash outage should degrade a protection, not take the
  whole API down — but "degrade" has to be visible in the logs, or it is just
  "silently off".

What this is for: protecting endpoints from abuse and cost. It is *not* an
authorization control, and the identifier it buckets on (IP, user id) is not a
security boundary — `X-Forwarded-For` is client-controlled unless a trusted
proxy overwrites it.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import Request

from app.core.config import Settings, get_settings
from app.core.errors import RateLimitExceededError
from app.core.logging import get_logger
from app.core.middleware import client_ip
from app.core.redis import RedisGateway, get_redis_gateway

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class Bucket:
    """A rate-limit policy: `limit` requests per `window_seconds`, by name."""

    name: str
    limit: int
    window_seconds: int


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    reset_seconds: int
    #: True when the decision was "allow" only because Redis was unavailable.
    #: Surfaced in the log so a fail-open period is measurable.
    degraded: bool = False

    @property
    def headers(self) -> dict[str, str]:
        """Standard rate-limit response headers.

        Emitted on every response that went through a limiter, not just 429s —
        a client that only learns its budget when it has exhausted it cannot
        back off gracefully.
        """
        headers = {
            "RateLimit-Limit": str(self.limit),
            "RateLimit-Remaining": str(max(0, self.remaining)),
            "RateLimit-Reset": str(self.reset_seconds),
        }
        if not self.allowed:
            headers["Retry-After"] = str(max(1, self.reset_seconds))
        return headers


#: Bucket definitions. Numbers match `src/lib/rate-limit.ts` exactly.
BUCKETS = {
    "login": Bucket("login", 8, 300),
    "signup": Bucket("signup", 5, 600),
    "password_reset": Bucket("password-reset", 5, 600),
    "listing_create": Bucket("listing-create", 10, 3600),
    "api": Bucket("api", 120, 60),
    #: New in Phase 8, because the backend has surfaces the frontend doesn't:
    #: a public payment-provider capability endpoint, and (in Phase 9) an
    #: unauthenticated provider webhook that must not be hammer-able.
    "payment_initiate": Bucket("payment-initiate", 10, 300),
    "webhook": Bucket("webhook", 600, 60),
}


class RateLimiter:
    """Sliding-window limiter over Redis sorted sets."""

    def __init__(
        self,
        gateway: RedisGateway | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._gateway = gateway or get_redis_gateway()
        self._settings = settings or get_settings()

    @property
    def enabled(self) -> bool:
        return bool(self._settings.rate_limit_enabled and self._gateway.is_configured)

    async def hit(
        self,
        bucket: Bucket | str,
        identifier: str,
        *,
        now_ms: int | None = None,
    ) -> RateLimitDecision:
        """Record one request against a bucket and return the decision.

        Never raises for a Redis problem — that is what `degraded` is for.
        """
        policy = bucket if isinstance(bucket, Bucket) else BUCKETS[bucket]

        if not self._settings.rate_limit_enabled:
            return RateLimitDecision(True, policy.limit, policy.limit, 0)

        if not self._gateway.is_configured:
            return self._degraded(policy, "redis_unconfigured")

        key = self._gateway.key("ratelimit", "v1", policy.name, _safe_identifier(identifier))
        current_ms = now_ms if now_ms is not None else int(time.time() * 1000)

        count = await self._gateway.sliding_window_count(
            key, window_seconds=policy.window_seconds, now_ms=current_ms
        )
        if count is None:
            return self._degraded(policy, "redis_error")

        allowed = count <= policy.limit
        remaining = max(0, policy.limit - count)
        reset = policy.window_seconds

        if not allowed:
            # Logged at WARNING with the bucket and identifier length only.
            # This is the event that tells you an attack is happening, so it
            # has to be findable; it also must not become a way to write
            # arbitrary attacker-controlled strings into the log, hence
            # `_safe_identifier`.
            logger.warning(
                "rate_limit_exceeded",
                extra={
                    "event": "rate_limit_exceeded",
                    "bucket": policy.name,
                    "limit": policy.limit,
                    "window_seconds": policy.window_seconds,
                    "count": count,
                    "identifier": _safe_identifier(identifier),
                },
            )

        return RateLimitDecision(allowed, policy.limit, remaining, reset)

    async def enforce(
        self,
        bucket: Bucket | str,
        identifier: str,
        *,
        now_ms: int | None = None,
    ) -> RateLimitDecision:
        """`hit`, but raises `RateLimitExceededError` (429) when over the limit."""
        decision = await self.hit(bucket, identifier, now_ms=now_ms)
        if not decision.allowed:
            raise RateLimitExceededError(retry_after_seconds=decision.reset_seconds)
        return decision

    def _degraded(self, policy: Bucket, reason: str) -> RateLimitDecision:
        if not self._settings.rate_limit_fail_open:
            logger.error(
                "rate_limit_fail_closed",
                extra={
                    "event": "rate_limit_fail_closed",
                    "bucket": policy.name,
                    "reason": reason,
                },
            )
            raise RateLimitExceededError(
                "Rate limiting is temporarily unavailable. Please try again shortly.",
                retry_after_seconds=policy.window_seconds,
            )
        logger.warning(
            "rate_limit_degraded",
            extra={
                "event": "rate_limit_degraded",
                "bucket": policy.name,
                "reason": reason,
                "fail_open": True,
            },
        )
        return RateLimitDecision(True, policy.limit, policy.limit, 0, degraded=True)


def _safe_identifier(identifier: str) -> str:
    """Normalize an identifier for use in a Redis key and a log line.

    Lowercased (so `A@B.com` and `a@b.com` share a bucket — otherwise the limit
    is trivially bypassed by varying case) and length-capped (so a client
    cannot make us allocate unbounded keys). Not hashed: a readable key makes
    `redis-cli` triage possible, and these identifiers are IPs and user ids,
    not secrets.
    """
    cleaned = "".join(
        character for character in identifier.strip().lower() if character.isalnum() or character in "@._-:"
    )
    return cleaned[:128] or "anonymous"


def request_identifier(request: Request) -> str:
    """Best bucketing key for a request: the authenticated user, else the IP.

    User-first because it is the identifier an attacker cannot rotate for free.
    IP-only is a fallback, and a weak one — see the module docstring on
    `X-Forwarded-For`.
    """
    subject = getattr(request.state, "user_id", None)
    if isinstance(subject, str) and subject:
        return f"user:{subject}"
    return f"ip:{client_ip(request.scope) or 'unknown'}"


def rate_limit_dependency(
    bucket: Bucket | str,
    identifier_from: Callable[[Request], str] = request_identifier,
) -> Callable[[Request], Awaitable[RateLimitDecision]]:
    """Build a FastAPI dependency that enforces a bucket on a route.

        @router.get("/things", dependencies=[Depends(rate_limit_dependency("api"))])
        async def list_things(): ...

    The limiter singleton is resolved inside the dependency, not at decoration
    time, so importing a router never touches configuration — which is what
    lets the test suite build the app with different settings per case.
    """

    async def dependency(request: Request) -> RateLimitDecision:
        return await get_rate_limiter().enforce(bucket, identifier_from(request))

    return dependency


_limiter: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    """Process-wide limiter singleton."""
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter()
    return _limiter


def reset_rate_limiter() -> None:
    """Drop the singleton. For tests that change settings between cases."""
    global _limiter
    _limiter = None


__all__ = [
    "BUCKETS",
    "Bucket",
    "RateLimitDecision",
    "RateLimiter",
    "get_rate_limiter",
    "rate_limit_dependency",
    "request_identifier",
    "reset_rate_limiter",
]
