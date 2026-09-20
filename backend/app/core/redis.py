"""Redis access: cache, rate limiting, and short-lived state. Nothing durable.

This is the backend's counterpart to the Phase 7 client in `src/lib/redis.ts`,
and it deliberately mirrors that module's two design decisions rather than
reinventing them:

* **Optional and null-safe.** An unconfigured Redis degrades the feature that
  needs it (rate limiting, caching) instead of taking the API down. Every
  method here returns a neutral value when the client is unavailable, and says
  so once in the log rather than on every call.
* **One shared keyspace.** Both stacks point at the same Redis instance — the
  Next.js app via Upstash's REST endpoint, this backend via the same database's
  TCP endpoint (`REDIS_URL`). Keys are namespaced under the same `malihub:`
  root, with the backend nesting under `malihub:api:` so the two never collide.

Note this is a *second client object*, not a second Redis. `@upstash/redis` is
a Node/edge HTTP client and cannot be imported from Python; there is no way to
share the client, only the server and the key conventions. Both are shared.

What belongs here: rate-limit counters, response caches, webhook idempotency
keys, pending-provider-request state with a TTL.
What does not: anything you would be upset to lose. Redis may be flushed,
evicted, or restarted at any time.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from app.core.config import Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

#: Backend keys nest under this so they cannot collide with the Next.js side's
#: `malihub:ratelimit:*` / `malihub:cache:*` keys.
BACKEND_NAMESPACE = "api"


class RedisUnavailableError(RuntimeError):
    """Raised only by callers that explicitly require Redis.

    The gateway itself never raises this: its methods degrade. A caller that
    genuinely cannot proceed without Redis (a fail-closed rate limiter, an
    idempotency guard on a payment webhook) asks for `require()` and gets this.
    """


class RedisGateway:
    """Thin async wrapper over `redis.asyncio`.

    Thin on purpose. The moment this grows query helpers or caching decorators,
    business logic starts depending on Redis-shaped behaviour instead of on a
    cache — and then Redis stops being swappable. Callers that need caching
    should implement "read cache, on miss read source, write cache" themselves
    around `get`/`set`.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._client: Any | None = None
        self._checked = False

    # ─── Lifecycle ──────────────────────────────────────────────────────────

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.redis_url)

    @property
    def client(self) -> Any | None:
        """The underlying `redis.asyncio.Redis`, or None if unconfigured.

        Exposed for the rare caller that needs a command this wrapper doesn't
        cover (a Lua script, a stream). Prefer the methods below.
        """
        if self._client is not None:
            return self._client
        if not self.is_configured:
            if not self._checked:
                logger.warning(
                    "redis_unconfigured",
                    extra={
                        "event": "redis_unconfigured",
                        "detail": "REDIS_URL is not set; rate limiting and caching are disabled.",
                    },
                )
                self._checked = True
            return None

        # Imported lazily: `redis` is a hard dependency in pyproject, but
        # importing it at module scope would mean a broken Redis install takes
        # down even the /health endpoint, which must stay up to report that
        # Redis is broken.
        from redis.asyncio import ConnectionPool, Redis

        pool = ConnectionPool.from_url(
            self._settings.redis_url.get_secret_value(),
            max_connections=self._settings.redis_max_connections,
            socket_timeout=self._settings.redis_socket_timeout_seconds,
            socket_connect_timeout=self._settings.redis_socket_timeout_seconds,
            # Fail loudly on a decode problem rather than handing a caller
            # bytes where it expected str.
            decode_responses=True,
            # TLS is negotiated from the rediss:// scheme; no verify bypass.
        )
        self._client = Redis(connection_pool=pool)
        logger.info(
            "redis_configured",
            extra={
                "event": "redis_configured",
                "host": _redact_url(self._settings.redis_url.get_secret_value()),
            },
        )
        return self._client

    def require(self) -> Any:
        """The client, or `RedisUnavailableError` for fail-closed callers."""
        client = self.client
        if client is None:
            raise RedisUnavailableError("Redis is not configured on this backend.")
        return client

    async def aclose(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:  # pragma: no cover - shutdown path
                logger.warning("redis_close_failed", extra={"event": "redis_close_failed"}, exc_info=True)
            finally:
                self._client = None

    async def ping(self) -> tuple[bool, float | None]:
        """(reachable, latency_ms). Used by `/api/v1/health/ready`.

        Never raises — an unreachable Redis is a *result* of a readiness check,
        not an exception to be handled by the endpoint.
        """
        client = self.client
        if client is None:
            return False, None
        started = time.perf_counter()
        try:
            await client.ping()
        except Exception as exc:
            logger.warning(
                "redis_ping_failed",
                extra={"event": "redis_ping_failed", "error_type": type(exc).__name__},
            )
            return False, None
        return True, round((time.perf_counter() - started) * 1000, 2)

    # ─── Keys ───────────────────────────────────────────────────────────────

    def key(self, *parts: str) -> str:
        """`malihub:api:<parts…>`, using the shared root prefix from settings."""
        return self._settings.redis_key(BACKEND_NAMESPACE, *parts)

    # ─── Operations ─────────────────────────────────────────────────────────

    async def get(self, key: str) -> str | None:
        client = self.client
        if client is None:
            return None
        try:
            return await client.get(key)
        except Exception as exc:
            self._log_failure("get", exc)
            return None

    async def set(self, key: str, value: str, *, ttl_seconds: int | None = None) -> bool:
        """Write a value. Returns False (rather than raising) if Redis is down.

        `ttl_seconds` should almost always be supplied: a key with no TTL is a
        leak in a shared keyspace, and Redis has no garbage collector.
        """
        client = self.client
        if client is None:
            return False
        try:
            if ttl_seconds is not None:
                await client.set(key, value, ex=max(1, ttl_seconds))
            else:
                await client.set(key, value)
            return True
        except Exception as exc:
            self._log_failure("set", exc)
            return False

    async def delete(self, key: str) -> bool:
        client = self.client
        if client is None:
            return False
        try:
            await client.delete(key)
            return True
        except Exception as exc:
            self._log_failure("delete", exc)
            return False

    async def incr(self, key: str, amount: int = 1) -> int | None:
        client = self.client
        if client is None:
            return None
        try:
            return int(await client.incrby(key, amount))
        except Exception as exc:
            self._log_failure("incr", exc)
            return None

    async def expire(self, key: str, ttl_seconds: int) -> bool:
        client = self.client
        if client is None:
            return False
        try:
            return bool(await client.expire(key, max(1, ttl_seconds)))
        except Exception as exc:
            self._log_failure("expire", exc)
            return False

    async def set_if_absent(self, key: str, value: str, *, ttl_seconds: int) -> bool:
        """Atomic `SET NX EX`. The idempotency primitive.

        This is what a payment webhook handler uses in Phase 9 to guarantee a
        provider's retried callback is processed exactly once: the first caller
        wins the key, everyone else gets False and must not re-apply the state
        transition. Returns False both when the key already exists *and* when
        Redis is unavailable, so a caller that cannot tolerate ambiguity should
        `require()` first.
        """
        client = self.client
        if client is None:
            return False
        try:
            return bool(await client.set(key, value, ex=max(1, ttl_seconds), nx=True))
        except Exception as exc:
            self._log_failure("set_if_absent", exc)
            return False

    async def sliding_window_count(
        self, key: str, *, window_seconds: int, now_ms: int | None = None
    ) -> int | None:
        """Count entries in a sorted-set sliding window, pruning as it goes.

        Used by `services.rate_limit`. A sorted set gives an exact sliding
        window (unlike a fixed-window counter, which lets a client burst to 2×
        the limit across a boundary) at the cost of one member per request,
        which for the limits here is trivially small.
        """
        client = self.client
        if client is None:
            return None
        current = now_ms if now_ms is not None else int(time.time() * 1000)
        window_start = current - (window_seconds * 1000)
        # The member has to be unique per request or two requests in the same
        # millisecond collapse into one sorted-set entry and the window
        # undercounts. uuid4 hex is unique and carries no user data.
        member = f"{current}:{uuid.uuid4().hex}"
        try:
            async with client.pipeline(transaction=True) as pipe:
                pipe.zremrangebyscore(key, 0, window_start)
                pipe.zadd(key, {member: current})
                pipe.zcard(key)
                pipe.expire(key, window_seconds + 1)
                results = await pipe.execute()
            # zremrangebyscore, zadd, zcard, expire
            return int(results[2])
        except Exception as exc:
            self._log_failure("sliding_window_count", exc)
            return None

    def _log_failure(self, operation: str, exc: Exception) -> None:
        # WARNING, not ERROR: by design a Redis outage degrades features rather
        # than failing requests, so this is expected-and-handled. The exception
        # *type* is logged; the message is not, because Redis errors can embed
        # the connection string.
        logger.warning(
            "redis_operation_failed",
            extra={
                "event": "redis_operation_failed",
                "operation": operation,
                "error_type": type(exc).__name__,
            },
        )


def _redact_url(url: str) -> str:
    """Log a DSN's host without its password. `user:pass@host` → `host`."""
    try:
        without_scheme = url.split("://", 1)[1]
        _, _, host = without_scheme.partition("@")
        return host.split("/")[0]
    except IndexError:
        return "unknown"


#: Module-level singleton, so the whole process shares one connection pool.
#: Constructing a gateway per request would create (and leak) a pool each time.
_gateway: RedisGateway | None = None


def get_redis_gateway() -> RedisGateway:
    global _gateway
    if _gateway is None:
        _gateway = RedisGateway()
    return _gateway


def reset_redis_gateway() -> None:
    """Drop the singleton. For tests that change settings between cases."""
    global _gateway
    _gateway = None
