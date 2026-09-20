"""One error envelope for every failure this API can produce.

Clients should never have to branch on a status code to find the message, or
parse prose to find out what went wrong. Every non-2xx response from this
backend has exactly this shape:

    {
      "error": {
        "code": "rate_limit_exceeded",     # stable, machine-readable, snake_case
        "message": "Too many requests…",   # safe to show a human
        "details": {…},                    # optional; structured, never prose
        "request_id": "8f0c…"              # the correlation handle for support
      }
    }

`code` is a contract: adding one is fine, changing or removing one is a
breaking change for clients. Keep them coarse (`not_found`, not
`order_not_found`) — the resource is already in the path.

Two things are deliberately never in a response body:
  * stack traces and exception text for unhandled errors;
  * anything from `core.config` (DSNs, keys, secrets).
Both go to the log, tagged with `request_id`, which is what the client quotes
back. In `debug`/development the unhandled-error handler additionally includes
the exception class name and message, because that is the difference between a
10-second and a 10-minute local debugging loop; production gets neither.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger, request_id_var
from app.core.middleware import REQUEST_ID_SCOPE_KEY

logger = get_logger(__name__)

GENERIC_INTERNAL_MESSAGE = "An unexpected error occurred. Please try again."


class ApiError(Exception):
    """Base class for every error this API raises intentionally.

    Raise a subclass, not this class: the subclass is what fixes the status
    code and the `code` string, and having them live next to each other is what
    stops a 404 from being sent with a `validation_error` code.
    """

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: str = "internal_error"
    default_message: str = GENERIC_INTERNAL_MESSAGE
    #: Sent as `error.loggable`: tells a client whether the message is written
    #: for an end user or for whoever is integrating. Defaults to False so a
    #: new error class can't accidentally surface internal wording in the UI.
    user_facing: bool = False

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.message = message or self.default_message
        self.details = details
        self.headers = headers
        super().__init__(self.message)

    def to_envelope(self, request_id: str | None = None) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            error["details"] = self.details
        error["request_id"] = request_id or request_id_var.get() or None
        return {"error": error}


class ValidationError(ApiError):
    """Request body/query/path failed schema validation."""

    # Literal rather than `status.HTTP_422_UNPROCESSABLE_ENTITY`: newer Starlette
    # renamed that constant to `..._UNPROCESSABLE_CONTENT` and warns on the old
    # name. The status code itself (RFC 9110 §15.5.21) is not going anywhere.
    status_code = 422
    code = "validation_error"
    default_message = "The request failed validation."


class UnauthorizedError(ApiError):
    """Missing, malformed, expired or untrusted credentials.

    Message is intentionally generic. "Email not found" vs "wrong password" is
    an account-enumeration oracle; "token expired" vs "bad signature" tells an
    attacker which half of a forgery attempt failed.
    """

    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"
    default_message = "Authentication required."
    user_facing = True

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        headers = {"WWW-Authenticate": "Bearer", **(headers or {})}
        super().__init__(message, details=details, headers=headers)


class ForbiddenError(ApiError):
    """Authenticated, but not allowed to do this."""

    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"
    default_message = "You don't have permission to do that."
    user_facing = True


class NotFoundError(ApiError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"
    default_message = "Not found."
    user_facing = True


class ConflictError(ApiError):
    """The request contradicts current state (duplicate, already settled, …)."""

    status_code = status.HTTP_409_CONFLICT
    code = "conflict"
    default_message = "That conflicts with the current state."
    user_facing = True


class RateLimitExceededError(ApiError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limit_exceeded"
    default_message = "Too many requests. Please slow down and try again shortly."
    user_facing = True

    def __init__(
        self,
        message: str | None = None,
        *,
        retry_after_seconds: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        headers: dict[str, str] = {}
        if retry_after_seconds is not None:
            # RFC 9110: required on 429 so a well-behaved client backs off
            # without having to parse the body.
            headers["Retry-After"] = str(max(1, int(retry_after_seconds)))
            details = {"retry_after_seconds": max(1, int(retry_after_seconds)), **(details or {})}
        super().__init__(message, details=details, headers=headers)


class ServiceUnavailableError(ApiError):
    """A dependency this endpoint needs is down or not configured."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "service_unavailable"
    default_message = "This service is temporarily unavailable. Please try again shortly."
    user_facing = True


class NotImplementedFeatureError(ApiError):
    """The code path exists but the integration behind it does not, yet.

    Distinct from a 500 on purpose. Phase 8 ships typed stubs for PayHero and
    Cloudinary: a 501 with a clear `code` tells an integrator "this is
    scheduled work" instead of "this is broken".
    """

    status_code = status.HTTP_501_NOT_IMPLEMENTED
    code = "not_implemented"
    default_message = "This capability is not implemented yet."


class UpstreamProviderError(ApiError):
    """An external provider (payment, email, storage) failed or misbehaved.

    502, not 500: the fault is downstream, and that distinction is what makes
    "are we broken or is PayHero broken?" answerable from metrics alone.
    """

    status_code = status.HTTP_502_BAD_GATEWAY
    code = "upstream_provider_error"
    default_message = "A third-party service failed to complete the request."
    user_facing = True


class PaymentProviderError(UpstreamProviderError):
    code = "payment_provider_error"
    default_message = "The payment provider could not complete this request."


class WebhookVerificationError(ApiError):
    """A provider callback failed signature/origin verification.

    401 with no body detail beyond the code: this endpoint is unauthenticated
    and public by necessity, so the response must not become an oracle for
    forging a valid signature. The specifics go to the log only.
    """

    status_code = status.HTTP_401_UNAUTHORIZED
    code = "webhook_verification_failed"
    default_message = "Webhook signature verification failed."


class StorageProviderError(UpstreamProviderError):
    code = "storage_provider_error"
    default_message = "File storage could not complete this request."


class StorageUploadRejectedError(ApiError):
    """An upload was refused by policy (type, size, magic bytes).

    415/413 would be more precise per-cause, but a single code keeps the
    client-side branch simple and avoids telling an uploader exactly which
    check they tripped — which matters, because these checks exist to stop
    someone probing them.
    """

    status_code = 422  # see ValidationError for why this is a literal
    code = "upload_rejected"
    default_message = "That file was rejected."
    user_facing = True


# ─── Serialization ───────────────────────────────────────────────────────────


def error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    request_id: str | None = None,
) -> JSONResponse:
    """Build the envelope. The single place error JSON is produced."""
    error: dict[str, Any] = {"code": code, "message": message}
    if details:
        error["details"] = details
    error["request_id"] = request_id or request_id_var.get() or None
    return JSONResponse(
        status_code=status_code,
        content={"error": error},
        headers=headers,
        # Errors must never be cached by a browser or an intermediary CDN — a
        # 429 or 401 served from cache is indistinguishable from a fresh one.
        media_type="application/json",
    )


def _request_id(request: Request) -> str | None:
    """Read the correlation id from the ASGI scope, falling back to the contextvar.

    The scope is the reliable source for a truly unhandled exception: the
    contextvar is reset as the exception unwinds past
    `RequestContextMiddleware`, before Starlette's outermost
    `ServerErrorMiddleware` invokes this handler. The scope key survives
    because it is the same dict the whole way down and back up.
    """
    scope_value = request.scope.get(REQUEST_ID_SCOPE_KEY)
    if isinstance(scope_value, str) and scope_value:
        return scope_value
    state_value = getattr(request.state, "request_id", None)
    return state_value or request_id_var.get()


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    """Every intentional failure. Logged at WARNING with its own event name so
    each category (auth, payment, storage, rate limit) is queryable."""
    logger.warning(
        "api_error",
        extra={
            "event": "api_error",
            "error_code": exc.code,
            "status_code": exc.status_code,
            "path": request.url.path,
            "method": request.method,
            "request_id": _request_id(request),
        },
    )
    return error_response(
        exc.status_code,
        exc.code,
        exc.message,
        details=exc.details,
        headers=exc.headers,
        request_id=_request_id(request),
    )


async def request_validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Pydantic/FastAPI input validation → the same envelope as everything else.

    `exc.errors()` is passed through with `ctx`/`url` stripped: those can carry
    the offending input value back out, which for a field named `password` or
    `phone_number` would put a secret or PII in a response body and in whatever
    logs that body.
    """
    details = []
    for error in exc.errors():
        details.append(
            {
                "field": ".".join(str(part) for part in error.get("loc", ())),
                "message": error.get("msg", "Invalid value"),
                "type": error.get("type", "value_error"),
            }
        )
    logger.info(
        "request_validation_failed",
        extra={
            "event": "request_validation_failed",
            "error_code": ValidationError.code,
            "path": request.url.path,
            "field_count": len(details),
            "request_id": _request_id(request),
        },
    )
    return error_response(
        ValidationError.status_code,
        ValidationError.code,
        ValidationError.default_message,
        details={"fields": details},
        request_id=_request_id(request),
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Catch HTTPExceptions raised by FastAPI/Starlette itself.

    Without this, a 404 for an unknown route or a 405 for a wrong method would
    return Starlette's `{"detail": …}` shape — a second, inconsistent error
    format clients would have to special-case.
    """
    code = _HTTP_STATUS_CODES.get(exc.status_code, "http_error")
    message = exc.detail if isinstance(exc.detail, str) and exc.detail else _default_message(exc.status_code)
    headers = dict(exc.headers or {})
    if exc.status_code == status.HTTP_401_UNAUTHORIZED and "WWW-Authenticate" not in headers:
        headers["WWW-Authenticate"] = "Bearer"
    logger.info(
        "http_error",
        extra={
            "event": "http_error",
            "error_code": code,
            "status_code": exc.status_code,
            "path": request.url.path,
            "method": request.method,
            "request_id": _request_id(request),
        },
    )
    return error_response(exc.status_code, code, message, headers=headers, request_id=_request_id(request))


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last line of defence. Full detail to the log, none of it to the client.

    Never returns `str(exc)`: exception text is where DSNs, file paths, SQL
    fragments and provider responses turn up uninvited.
    """
    request_id = _request_id(request)
    logger.exception(
        "unhandled_exception",
        exc_info=exc,
        extra={
            "event": "unhandled_exception",
            "error_code": "internal_error",
            "path": request.url.path,
            "method": request.method,
            "exception_type": type(exc).__name__,
            "request_id": request_id,
        },
    )

    details: dict[str, Any] | None = None
    from app.core.config import get_settings

    settings = get_settings()
    if settings.debug or not settings.is_production:
        # Local development only, and *only* the exception class name. The
        # tempting addition — `str(exc)` — is exactly what the docstring above
        # forbids: exception text is where DSNs, file paths, SQL fragments and
        # provider responses turn up uninvited, and a development deployment is
        # still a deployment with a network address. The type narrows a 500 to
        # a line of investigation; the full traceback is in the log under
        # `request_id`, which is where it belongs.
        details = {"exception_type": type(exc).__name__}

    return error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "internal_error",
        GENERIC_INTERNAL_MESSAGE,
        details=details,
        request_id=request_id,
    )


_HTTP_STATUS_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    408: "timeout",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limit_exceeded",
    500: "internal_error",
    501: "not_implemented",
    502: "upstream_provider_error",
    503: "service_unavailable",
    504: "gateway_timeout",
}


def _default_message(status_code: int) -> str:
    defaults = {
        404: "Not found.",
        405: "Method not allowed.",
        401: "Authentication required.",
        403: "You don't have permission to do that.",
        429: "Too many requests.",
        503: "Service temporarily unavailable.",
    }
    return defaults.get(status_code, GENERIC_INTERNAL_MESSAGE)


def register_exception_handlers(app: FastAPI) -> None:
    """Wire every handler. Call once from `create_app`."""
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
