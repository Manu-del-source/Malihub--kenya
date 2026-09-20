"""Request-scoped middleware: correlation id, access log, security headers.

Written as pure ASGI rather than `BaseHTTPMiddleware` for two reasons that
matter here:

* It sits *outside* the router but *inside* Starlette's `ServerErrorMiddleware`,
  so it must not buffer or wrap the response body. `BaseHTTPMiddleware` does
  exactly that, which breaks streaming responses and re-raises exceptions in a
  way that loses the original traceback.
* It needs to stamp the request id onto the ASGI `scope`, which survives
  unwinding into the catch-all exception handler. A contextvar does not: it is
  reset as the exception propagates back out through this middleware, before
  `core.errors.unhandled_exception_handler` runs.
"""

from __future__ import annotations

import re
import time
import uuid
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import get_logger, request_id_var

logger = get_logger("app.access")

#: Scope key the request id is stashed under. Namespaced so nothing else in the
#: ASGI stack can collide with it.
REQUEST_ID_SCOPE_KEY = "malihub_request_id"
REQUEST_ID_HEADER = b"x-request-id"

#: An inbound `X-Request-ID` is honoured only if it looks like a sane
#: correlation id. Unbounded, this header is a log-injection and log-bloat
#: vector: a client could send 10 KB of newlines and have them written verbatim
#: into every log line for their request.
_VALID_INBOUND_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,128}$")

#: Headers that must never be echoed back or logged.
_HOP_BY_HOP = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
    }
)

#: Paths that are pure infrastructure noise — load balancers and container
#: orchestrators hit these every few seconds, and logging each one buries the
#: lines that matter. Still logged, at DEBUG.
QUIET_PATHS = frozenset({"/health", "/api/v1/health", "/api/v1/health/ready"})


def get_request_id(scope: Scope) -> str | None:
    """Read the correlation id off an ASGI scope. Safe from anywhere."""
    value = scope.get(REQUEST_ID_SCOPE_KEY)
    return value if isinstance(value, str) else None


def new_request_id() -> str:
    return uuid.uuid4().hex


class RequestContextMiddleware:
    """Assign a request id, time the request, emit one access-log line.

    Also stamps the id onto the response as `X-Request-ID`, so a user reporting
    an error can read it straight off the network tab and support can go
    directly to the matching log lines.
    """

    def __init__(self, app: ASGIApp, *, log_quiet_paths: bool = False) -> None:
        self.app = app
        self.log_quiet_paths = log_quiet_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = self._resolve_inbound(scope)
        scope[REQUEST_ID_SCOPE_KEY] = request_id
        # Mirror onto Starlette's per-request state so `request.state.request_id`
        # also works, without clobbering anything already there.
        state = scope.setdefault("state", {})
        if isinstance(state, dict):
            state["request_id"] = request_id

        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 0

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower().decode("latin-1") not in _HOP_BY_HOP and key.lower() != REQUEST_ID_HEADER
                ]
                headers.append((REQUEST_ID_HEADER, request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            self._log_access(scope, status_code, duration_ms)
            request_id_var.reset(token)

    def _resolve_inbound(self, scope: Scope) -> str:
        """Reuse a caller's correlation id if it is well-formed, else mint one.

        Reusing is what lets one browser action be traced across the Next.js
        frontend and this backend. The regex gate is what makes that safe.
        """
        for key, value in scope.get("headers", []):
            if key.lower() == REQUEST_ID_HEADER:
                candidate = value.decode("latin-1").strip()
                if _VALID_INBOUND_REQUEST_ID.match(candidate):
                    return candidate
                logger.debug(
                    "rejected malformed inbound request id header",
                    extra={"event": "request_id_rejected", "reason": "invalid_format"},
                )
                break
        return new_request_id()

    def _log_access(self, scope: Scope, status_code: int, duration_ms: float) -> None:
        path: str = scope.get("path", "")
        method: str = scope.get("method", "")
        quiet = path in QUIET_PATHS and not self.log_quiet_paths

        # `route` is the *template* (`/api/v1/products/{id}`), not the concrete
        # path. Aggregating access logs by concrete path makes every URL with an
        # id in it its own series, which is useless for dashboards and a cheap
        # way for an attacker to blow up log cardinality.
        route = scope.get("route")
        route_path = getattr(route, "path", None)
        query_string = scope.get("query_string", b"").decode("latin-1")

        extra: dict[str, Any] = {
            "event": "http_request",
            "method": method,
            "path": path,
            "route": route_path or path,
            "status_code": status_code,
            "duration_ms": duration_ms,
            "http_version": scope.get("http_version"),
            "ip_address": client_ip(scope),
            "user_agent": _header(scope, "user-agent"),
            "request_id": get_request_id(scope),
        }
        if query_string:
            # Query strings carry search terms and occasionally ids; they are
            # scrubbed by the redaction filter, and dropped entirely for quiet
            # paths where they are meaningless.
            extra["query_length"] = len(query_string)

        level = "debug" if quiet else ("warning" if status_code >= 500 else "info")
        getattr(logger, level)(
            f"{method} {route_path or path} → {status_code} in {duration_ms}ms",
            extra=extra,
        )


class SecurityHeadersMiddleware:
    """Baseline response headers, mirroring the ones `next.config.ts` sets.

    A JSON API needs fewer of these than a document-serving app, but the ones
    it does need are cheap and stop real problems: `nosniff` prevents a
    mis-typed upload from being interpreted as script, and `no-store` keeps a
    shared proxy from handing one user's 401/429 (or worse, a 200 carrying
    another user's data) to the next requester.
    """

    HEADERS: tuple[tuple[bytes, bytes], ...] = (
        (b"x-content-type-options", b"nosniff"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
        (b"cache-control", b"no-store, max-age=0"),
        (b"pragma", b"no-cache"),
        (b"x-frame-options", b"DENY"),
        # An API has no reason to be embedded in a document at all.
        (b"cross-origin-opener-policy", b"same-origin"),
    )

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = {key.lower() for key, _ in message.get("headers", [])}
                headers = list(message.get("headers", []))
                headers.extend((key, value) for key, value in self.HEADERS if key not in existing)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_wrapper)


def client_ip(scope: Scope) -> str | None:
    """Best-effort client IP, preferring the first untrusted-proxy hop.

    `X-Forwarded-For` is client-controlled unless a trusted proxy overwrites
    it, so this is used for logging and rate-limit bucketing behind a known
    reverse proxy only — never as an authorization decision. It is logged
    under the key `ip_address`, which `core.logging` masks to its first two
    octets.
    """
    forwarded = _header(scope, "x-forwarded-for")
    if forwarded:
        candidate = forwarded.split(",")[0].strip()
        if candidate:
            return candidate
    client = scope.get("client")
    return client[0] if client else None


def _header(scope: Scope, name: str) -> str | None:
    target = name.lower().encode("latin-1")
    for key, value in scope.get("headers", []):
        if key.lower() == target:
            return value.decode("latin-1")
    return None


#: Convenience alias for `app.add_middleware(...)` call sites.
RequestContext = RequestContextMiddleware

__all__ = [
    "REQUEST_ID_SCOPE_KEY",
    "RequestContextMiddleware",
    "SecurityHeadersMiddleware",
    "client_ip",
    "get_request_id",
    "new_request_id",
]
