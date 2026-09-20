"""MaliHub Kenya — FastAPI application factory.

Run it:

    cd backend
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

or from the repository root: `npm run backend:dev`.

`create_app()` is a factory rather than a module-level `app = FastAPI()` alone,
so the test suite can build an app against different `Settings` per case
instead of monkeypatching a global. The module-level `app` at the bottom is
what uvicorn imports.

Middleware order is not arbitrary. `add_middleware` *inserts at the front* of
Starlette's middleware list, so the last one added is the outermost. The stack
below (outermost first) is what that produces, and each position is load-bearing:

    ServerErrorMiddleware        (Starlette; backstop for anything that escapes)
    CORSMiddleware               ← must be outside every error producer
    RequestContextMiddleware     ← request id, timing, access log
    SecurityHeadersMiddleware
    ExceptionGuardMiddleware     ← turns an escaping exception into the envelope
    ExceptionMiddleware          (Starlette; ApiError / validation / HTTPException)
    Router

The two orderings that matter:

* **CORS outside the error producers.** A 401, 429 or 500 without
  `Access-Control-Allow-Origin` is invisible to browser JavaScript — the fetch
  rejects as an opaque network error and the frontend cannot read the
  `error.code` it needs to show the right message. `ExceptionMiddleware` sits
  inside CORS, so its responses get the headers.
* **ExceptionGuard inside CORS.** Starlette routes a truly unhandled exception
  to `ServerErrorMiddleware`, which is outside *everything*, including CORS —
  so a bare 500 would arrive without CORS headers. The guard catches it one
  layer in, inside CORS, and renders it through the same handler the backstop
  uses. One implementation, two entry points.

`RequestContextMiddleware` sits outside the guard so the guard's error response
still passes back through it and gets stamped with `X-Request-ID` and an access
log line — which is exactly the case where the request id matters most.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.v1.router import api_router
from app.core.config import Settings, get_settings, reset_settings, set_settings
from app.core.db import get_database, reset_database
from app.core.errors import (
    register_exception_handlers,
    unhandled_exception_handler,
)
from app.core.logging import configure_logging, get_logger
from app.core.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from app.core.redis import get_redis_gateway, reset_redis_gateway
from app.core.security import get_token_verifier, reset_token_verifier
from app.providers.payments.registry import get_payment_registry, reset_payment_registry
from app.schemas.common import ServiceInfo
from app.services.email_service import reset_email_service
from app.services.payment_service import reset_payment_service
from app.services.rate_limit import reset_rate_limiter
from app.services.storage_service import reset_storage_service

logger = get_logger(__name__)

_STARTED_AT = time.monotonic()


class ExceptionGuardMiddleware:
    """Render any exception that escapes the router as the standard envelope.

    Without this, an unhandled exception is caught by Starlette's
    `ServerErrorMiddleware`, which sits *outside* `CORSMiddleware` — so the
    resulting 500 carries no CORS headers and the browser hides it from the
    frontend as an opaque network error. Catching it one layer in keeps the
    response both consistent and readable.

    Delegates to `core.errors.unhandled_exception_handler`, so there is exactly
    one implementation of "what a 500 looks like". The app-level handler for
    `Exception` stays registered as the backstop for anything that escapes this
    middleware too.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            if response_started:
                # Headers are already on the wire; a JSON body now would be
                # appended to a half-sent response. Re-raise and let the
                # server close the connection — the only correct option.
                raise
            request = Request(scope, receive=receive)
            response = await unhandled_exception_handler(request, exc)
            await response(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup and shutdown.

    Startup does three things, in this order on purpose:
      1. Logging — before anything else, so a configuration failure is logged
         rather than printed to a half-configured stderr.
      2. Configuration validation — fail fast and loudly on a deployment that
         must not run (no CORS origins in production, docs enabled, no Supabase
         verification). Better a crash-loop with a clear message than an
         instance serving traffic with a security control silently off.
      3. Warm the singletons — so the first request doesn't pay for provider
         construction, and so a broken adapter fails at boot, not at a
         customer's checkout.
    """
    settings: Settings = app.state.settings

    configure_logging(
        level=settings.log_level,
        log_format=settings.log_format,
        service="malihub-api",
        environment=settings.environment,
        force=True,
    )

    try:
        warnings = settings.validate_for_environment()
    except Exception as exc:
        logger.critical(
            "startup_configuration_invalid",
            extra={
                "event": "startup_configuration_invalid",
                "error_type": type(exc).__name__,
                "detail": str(exc),  # ConfigurationError messages are written to be safe to display.
            },
        )
        raise

    for warning in warnings:
        # The warning text *is* the message — it is written to be read by
        # whoever is staring at a crash loop, so it goes where they'll see it.
        logger.warning(warning, extra={"event": "startup_configuration_warning"})

    # Warm singletons.
    verifier = get_token_verifier(settings)
    registry = get_payment_registry()

    logger.info(
        "application_startup",
        extra={
            "event": "application_startup",
            "service": settings.app_name,
            "version": settings.app_version,
            "environment": settings.environment,
            "api_v1_prefix": settings.api_v1_prefix,
            "cors_origin_count": len(settings.cors_origins),
            "cors_allow_credentials": settings.cors_allow_credentials,
            "docs_enabled": settings.enable_docs,
            "database_configured": bool(settings.database_url),
            "redis_configured": bool(settings.redis_url),
            "auth_mode": getattr(verifier, "mode", "unconfigured"),
            "payment_providers": [provider.name.value for provider in registry],
            "default_payment_provider": settings.payments_default_provider,
            "storage_provider": settings.storage_provider,
            "email_provider": settings.email_provider,
            "startup_duration_ms": round((time.monotonic() - _STARTED_AT) * 1000, 2),
        },
    )

    try:
        yield
    finally:
        await _shutdown()


async def _shutdown() -> None:
    """Release pooled resources. Best-effort: a shutdown failure must not mask
    whatever caused the shutdown in the first place."""
    for label, coro in (
        ("database", get_database().dispose()),
        ("redis", get_redis_gateway().aclose()),
    ):
        try:
            await coro
        except Exception:  # pragma: no cover - shutdown path
            logger.warning(
                "shutdown_cleanup_failed",
                extra={"event": "shutdown_cleanup_failed", "resource": label},
                exc_info=True,
            )

    logger.info("application_shutdown", extra={"event": "application_shutdown"})

    # Drop every cached singleton so a subsequent `create_app()` in the same
    # process (the test suite) cannot inherit state built from old settings.
    for reset in (
        reset_database,
        reset_redis_gateway,
        reset_payment_registry,
        reset_payment_service,
        reset_storage_service,
        reset_email_service,
        reset_rate_limiter,
        reset_token_verifier,
        reset_settings,
    ):
        reset()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application. See the module docstring for middleware ordering."""
    resolved = settings or get_settings()
    # Prime the process-wide cache so a route's `Depends(get_settings)` resolves
    # to the same object this app was built from. Without it, the first caller
    # to `get_settings()` decides the configuration for the whole process.
    set_settings(resolved)

    docs_url = "/docs" if resolved.enable_docs else None
    redoc_url = "/redoc" if resolved.enable_docs else None
    openapi_url = "/openapi.json" if resolved.enable_docs else None

    app = FastAPI(
        title=resolved.app_name,
        version=resolved.app_version,
        summary=(
            "MaliHub Kenya's independent backend API. Supabase remains the "
            "identity provider; this service owns application data, payments "
            "orchestration, storage and email."
        ),
        description=_openapi_description(resolved),
        openapi_url=openapi_url,
        docs_url=docs_url,
        redoc_url=redoc_url,
        lifespan=lifespan,
        # A 500 rendered by Starlette's default handler would bypass the error
        # envelope. The guard middleware and the registered handler cover it;
        # `debug=False` keeps stack traces out of responses regardless.
        debug=False,
    )
    app.state.settings = resolved

    # ─── Middleware (added innermost-first; last add = outermost) ────────────
    app.add_middleware(ExceptionGuardMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        # An explicit list, never `["*"]`. `validate_for_environment()` refuses
        # to boot a production deployment with an empty list, and
        # `Settings._normalize_origins` rejects a literal `*` outright — so
        # there is no path from configuration to a wildcard.
        allow_origins=list(resolved.cors_origins),
        allow_origin_regex=resolved.cors_origin_regex,
        allow_credentials=resolved.cors_allow_credentials,
        allow_methods=list(resolved.cors_allow_methods),
        allow_headers=list(resolved.cors_allow_headers),
        expose_headers=[
            "X-Request-ID",
            "RateLimit-Limit",
            "RateLimit-Remaining",
            "RateLimit-Reset",
            "Retry-After",
        ],
        max_age=resolved.cors_max_age_seconds,
    )

    register_exception_handlers(app)

    # ─── Routes ──────────────────────────────────────────────────────────────
    app.include_router(api_router, prefix=resolved.api_v1_prefix)

    @app.get("/", response_model=ServiceInfo, include_in_schema=False)
    async def root() -> ServiceInfo:
        """The smallest useful answer for someone who finds the root URL."""
        return ServiceInfo(
            service=resolved.app_name,
            version=resolved.app_version,
            environment=resolved.environment,
            api_version=resolved.api_v1_prefix.rstrip("/").rsplit("/", 1)[-1] or "v1",
            documentation_url=docs_url,
            health_url=f"{resolved.api_v1_prefix.rstrip('/')}/health",
        )

    return app


def _openapi_description(settings: Settings) -> str:
    """Long-form schema description. Only rendered when docs are enabled."""
    return (
        "## Architecture\n\n"
        "* **Frontend** — Next.js 15 App Router (this repository's `src/`).\n"
        "* **Backend** — this service. Versioned under `/api/v1`.\n"
        "* **Database** — independent PostgreSQL. `prisma/schema.prisma` owns the DDL.\n"
        "* **Authentication** — Supabase. This API *verifies* Supabase-issued JWTs; "
        "it has no users, no passwords and no login endpoint.\n"
        "* **Redis** — cache, rate limiting, short-lived state. Never a datastore.\n"
        "* **Storage** — external provider (Cloudinary). Never Supabase Storage.\n"
        "* **Email** — Resend.\n"
        "* **Payments** — provider-agnostic. PayHero is the first provider "
        "(**stubbed in Phase 8; implemented in Phase 9**); Daraja is reserved.\n\n"
        "## Errors\n\n"
        'Every non-2xx response has the shape `{"error": {code, message, details?, request_id}}`. '
        "`code` is stable and machine-readable. The `request_id` is also sent as the "
        "`X-Request-ID` response header and is what to quote when reporting a problem.\n\n"
        "## Authentication\n\n"
        "Send the Supabase access token the frontend already holds: "
        "`Authorization: Bearer <token>`. Cookies, query-string tokens and custom "
        "headers are not accepted.\n"
    )


#: What `uvicorn app.main:app` imports.
app = create_app()


__all__ = ["ExceptionGuardMiddleware", "app", "create_app", "lifespan"]
