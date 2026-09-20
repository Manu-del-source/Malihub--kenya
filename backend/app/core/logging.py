"""Structured logging with mandatory secret/PII redaction.

Two layers, both applied to every record regardless of how it was logged:

1. `RedactionFilter` — walks the record's structured fields and replaces the
   value of any key that looks like a credential or personal identifier with
   `[REDACTED:<key>]`. This is the primary control, and it is why call sites
   should log structured fields (`logger.info("x", extra={...})`) rather than
   interpolating secrets into a message string.
2. `_scrub_text` — a regex pass over the final formatted message, catching
   `Bearer <token>`, `eyJ...` JWTs, and Postgres/Redis DSNs that someone
   interpolated into a string anyway. Defence in depth for the case where
   layer 1 cannot help.

Neither layer is optional and neither can be turned off by configuration: the
failure mode they prevent (an API key or a customer's MSISDN landing in a
shared log aggregator) is not recoverable after the fact.

Every line carries a `request_id` from `core.middleware`, which is also
returned to the client in the `X-Request-ID` header and embedded in every
error response — that is the correlation handle for "the user says they got an
error at 14:03".
"""

from __future__ import annotations

import contextlib
import json
import logging
import re
import sys
import time
from contextvars import ContextVar
from typing import Any

#: Set per-request by `core.middleware.RequestContextMiddleware`. A ContextVar
#: (not thread-local) because the backend is async: many requests share a
#: thread, and each awaits across task boundaries.
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

REDACTED = "[REDACTED]"

#: Unambiguous substrings: if one of these appears anywhere in a key, the value
#: is sensitive. Long enough that they don't occur in ordinary diagnostic field
#: names (`api_key` yes, `cache_key` …also yes, which is acceptable — a cache
#: key is rarely interesting enough to lose sleep over).
SENSITIVE_KEY_PARTS: frozenset[str] = frozenset(
    {
        # Credentials & tokens
        "password",
        "passwd",
        "secret",
        "token",
        "authorization",
        "auth_header",
        "cookie",
        "api_key",
        "apikey",
        "access_key",
        "private_key",
        "passkey",
        "passphrase",
        "session_id",
        "signature",
        "client_secret",
        "webhook_secret",
        "credential_id",
        # Payment secrets
        "card_number",
        "cardnumber",
        "cvv",
        "cvc",
        "iban",
        # Personal identifiers we keep on a Payment row but never in logs
        "msisdn",
        "phone_number",
        "payer_reference",
        "id_number",
        "national_id",
        "kra_pin",
    }
)

#: Short tokens that are only sensitive as whole words. Substring matching these
#: is what turns `spinner_count` into a redaction (`pin`) or `expand` into one
#: (`pan`), so they are matched against the key's `_`/camelCase-split tokens
#: instead.
SENSITIVE_KEY_TOKENS: frozenset[str] = frozenset(
    {
        "password",
        "pwd",
        "secret",
        "token",
        "jwt",
        "pin",
        "pan",
        "otp",
        "cvv",
        "cvc",
        "phone",
        "credential",
        "credentials",
        "key",
        "keys",
        "jwt_secret",
    }
)

#: Fields that are identifying but genuinely useful for diagnosis, so they are
#: *masked* rather than dropped: `a***@e***.com` still lets you tell two users
#: apart in a log without being able to contact either of them.
#:
#: Matched by shape, not substring — `email_provider` and `emails_sent` are
#: configuration and counters, not addresses, and redacting them costs
#: diagnostics for no privacy gain.
MASKABLE_KEY_SUFFIXES: tuple[str, ...] = ("email", "ip_address", "user_agent", "address")

_JWT_PATTERN = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b")
# Well-known credential prefixes. These are recognizable with no surrounding
# context, which matters: `_ASSIGNMENT_PATTERN` needs a `key=value` shape and
# `_BEARER_PATTERN` needs an auth scheme, so a bare key interpolated into a
# sentence ("could not authenticate with sk_live_abc…") would otherwise go
# straight through. Every prefix here is published by its issuer.
_KNOWN_SECRET_PATTERN = re.compile(
    r"\b(?:"
    r"sk_live_[A-Za-z0-9]{8,}"  # Stripe-style secret key (Resend, PayHero test keys)
    r"|sk_test_[A-Za-z0-9]{8,}"
    r"|rk_live_[A-Za-z0-9]{8,}"
    r"|re_[A-Za-z0-9_]{16,}"  # Resend API key
    r"|AKIA[0-9A-Z]{16}"  # AWS access key id
    r"|ghp_[A-Za-z0-9]{20,}"  # GitHub PAT
    r"|github_pat_[A-Za-z0-9_]{20,}"
    r"|glpat-[A-Za-z0-9_-]{20,}"  # GitLab PAT
    r"|xox[baprs]-[A-Za-z0-9-]{10,}"  # Slack
    r"|AIza[0-9A-Za-z_-]{30,}"  # Google API key
    r"|supabase_secret_[A-Za-z0-9._-]{16,}"
    r"|eyJ[A-Za-z0-9_-]{8,}"  # bare JWT prefix (unsigned or truncated)
    r")\b"
)
# HTTP auth schemes only. `token` was in this group and had to come out: it
# matched ordinary prose ("Supabase token verification is unconfigured" →
# "Supabase token [REDACTED]"), which destroys the diagnostics the log exists
# to provide. A bare `token <value>` is instead caught by the assignment
# pattern below, which requires an explicit separator prose never has.
_BEARER_PATTERN = re.compile(r"(?i)\b(bearer|basic)\s+([A-Za-z0-9._~+/=-]{8,})")
# `key=value` / `secret: value` — the shape a credential actually takes when
# someone interpolates one into a message.
_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)\b(password|passwd|secret|token|api[-_]?key|apikey|passkey|access[-_]?key|"
    r"private[-_]?key|client[-_]?secret|webhook[-_]?secret|authorization)"
    r"(\s*[:=]\s*)(['\"]?)([^\s'\";,}]{8,})"
)
_DSN_PATTERN = re.compile(r"(?i)\b(postgres(?:ql)?(?:\+\w+)?|redis(?:s)?|amqps?|mysql)://[^\s'\"<>]*")


def _scrub_text(text: str) -> str:
    """Remove credentials that made it into a free-form message string."""
    if not text:
        return text
    text = _JWT_PATTERN.sub(REDACTED, text)
    text = _KNOWN_SECRET_PATTERN.sub(REDACTED, text)
    text = _BEARER_PATTERN.sub(lambda m: f"{m.group(1)} {REDACTED}", text)
    text = _ASSIGNMENT_PATTERN.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}{REDACTED}", text)
    text = _DSN_PATTERN.sub(lambda m: f"{m.group(1)}://{REDACTED}", text)
    return text


def _mask_value(key: str, value: Any) -> Any:
    """Partially mask a value that is useful-but-identifying (email, IP)."""
    if not isinstance(value, str) or not value:
        return REDACTED
    if "email" in key:
        local, _, domain = value.partition("@")
        if not domain:
            return REDACTED
        head = local[:2] if len(local) > 2 else local[:1]
        return f"{head}***@{domain[0]}***" if domain else f"{head}***"
    if "user_agent" in key:
        return value[:24] + "…" if len(value) > 24 else value
    # IP addresses: keep the first octet(s) so you can still spot one host
    # hammering an endpoint, drop the rest.
    if ":" in value:  # IPv6
        return value.split(":")[0] + ":***"
    parts = value.split(".")
    if len(parts) == 4:
        return f"{parts[0]}.{parts[1]}.*.*"
    return REDACTED


def _normalize_key(key: str) -> str:
    """`payheroApiKey` / `payhero-api-key` / `payhero_api_key` → `payhero_api_key`."""
    split_camel = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key)
    return re.sub(r"[-\s]+", "_", split_camel).lower()


def _is_sensitive_key(key: str) -> bool:
    lowered = _normalize_key(key)
    if any(part in lowered for part in SENSITIVE_KEY_PARTS):
        return True
    return bool(set(lowered.split("_")) & SENSITIVE_KEY_TOKENS)


def _is_maskable_key(key: str) -> bool:
    lowered = _normalize_key(key)
    return lowered.endswith(MASKABLE_KEY_SUFFIXES) or lowered == "ip"


def _is_secret_bearing(value: Any) -> bool:
    """Only string-ish values can carry a secret.

    This one check removes most of the false positives a broad key list
    produces: `has_credentials=True`, `cors_allow_credentials=False`,
    `channel_id_configured=1` are booleans and counters describing whether a
    secret is *present*, and redacting them destroys exactly the diagnostic
    that tells you a deployment is misconfigured.
    """
    if value is None or isinstance(value, bool):
        return False
    return not isinstance(value, (int, float))


def redact_mapping(data: dict[str, Any]) -> dict[str, Any]:
    """Recursively redact a mapping. Safe on arbitrary nested JSON-ish data."""
    redacted: dict[str, Any] = {}
    for key, value in data.items():
        string_key = str(key)
        if _is_secret_bearing(value) and _is_sensitive_key(string_key):
            redacted[string_key] = f"{REDACTED}:{string_key}"
        elif isinstance(value, dict):
            redacted[string_key] = redact_mapping(value)
        elif isinstance(value, (list, tuple)):
            redacted[string_key] = [
                redact_mapping(item) if isinstance(item, dict) else item for item in value
            ]
        elif isinstance(value, str) and _is_maskable_key(string_key):
            redacted[string_key] = _mask_value(string_key, value)
        else:
            redacted[string_key] = value
    return redacted


#: Names `logging` owns. Passing any of these in `extra=` makes the stdlib
#: raise ``KeyError: "Attempt to overwrite 'filename' in LogRecord"``.
RESERVED_LOG_KEYS: frozenset[str] = frozenset(
    logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys()
) | {"message", "asctime", "taskName"}


def safe_extra(**fields: Any) -> dict[str, Any]:
    """Build an `extra=` dict that cannot crash the stdlib logger.

    ``logger.info("…", extra={"filename": "cat.png"})`` raises ``KeyError``
    from inside ``logging`` — `filename` is one of the attributes a
    ``LogRecord`` already carries, and the stdlib refuses to overwrite it.
    That is a landmine: the natural field name for an upload rejection log is
    exactly `filename`, and the failure happens only at runtime, in whichever
    code path logs it, turning a 422 into a 500.

    Reserved names are re-prefixed as ``x_<name>`` rather than dropped, so the
    value still reaches the log and a search for the real name still finds it.
    """
    extra: dict[str, Any] = {}
    for key, value in fields.items():
        if key in RESERVED_LOG_KEYS:
            key = f"x_{key}"
            if key in RESERVED_LOG_KEYS:  # pathological, but do not loop
                continue
        extra[key] = value
    return extra


class RedactionFilter(logging.Filter):
    """Redacts `extra={...}` fields and scrubs the message. Attach to every handler.

    This is a *handler*-level filter, which is the standard logging mechanism —
    and it has one consequence worth knowing: a handler attached by something
    else (a platform log exporter, a test harness, a second StreamHandler)
    receives unredacted records unless it adds this filter too. `configure_logging`
    installs it on the handler it creates; if you add another handler, add
    `RedactionFilter()` to it. It is exported for exactly that reason.
    """

    #: Attributes logging itself sets; anything else on a record came from
    #: `extra=` and is therefore caller data worth redacting.
    _RESERVED = RESERVED_LOG_KEYS

    def filter(self, record: logging.LogRecord) -> bool:
        # Branch order matters and must match `redact_mapping`'s: the key name
        # is checked first. An earlier version tested `isinstance(value, dict)`
        # first, so `extra={"credentials": {...}}` walked *into* the dict and
        # kept every field the sensitive-key rule does not recognize —
        # `username`, `channel_id` — under a key whose name says the whole
        # blob is secret. Checking the key first redacts the blob, as designed.
        for key in list(record.__dict__):
            if key in self._RESERVED:
                continue
            value = record.__dict__[key]
            if _is_secret_bearing(value) and _is_sensitive_key(key):
                record.__dict__[key] = f"{REDACTED}:{key}"
            elif isinstance(value, dict):
                record.__dict__[key] = redact_mapping(value)
            elif isinstance(value, str) and _is_maskable_key(key):
                record.__dict__[key] = _mask_value(key, value)

        if isinstance(record.msg, str):
            record.msg = _scrub_text(record.msg)
        if record.args:
            # Format eagerly, then scrub. Doing it here (rather than relying on
            # the handler) means the scrubbed text is what both formatters see.
            # If formatting the args fails (a mismatched `%s` count), the
            # un-formatted template stays as `msg` and the args are still
            # dropped below — a logging call must not become the thing that
            # raises.
            with contextlib.suppress(TypeError, ValueError):
                record.msg = _scrub_text(record.getMessage())
            record.args = ()
        return True


class RequestContextFilter(logging.Filter):
    """Attach the current request id (and env/service) to every record."""

    def __init__(self, service: str, environment: str) -> None:
        super().__init__()
        self.service = service
        self.environment = environment

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get() or "-"
        record.service = self.service
        record.environment = self.environment
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line, parseable by any log aggregator.

    Field order is stable so `grep`/`jq` output is readable. Exceptions are
    rendered into `exc_text` (and scrubbed) rather than a multi-line
    traceback, which would break line-oriented ingestion.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "service": getattr(record, "service", "-"),
            "environment": getattr(record, "environment", "-"),
            "request_id": getattr(record, "request_id", "-"),
        }

        for key, value in record.__dict__.items():
            if key in payload or key.startswith("_"):
                continue
            if key in {
                "args",
                "asctime",
                "created",
                "exc_info",
                "exc_text",
                "filename",
                "funcName",
                "levelname",
                "levelno",
                "lineno",
                "module",
                "msecs",
                "msg",
                "name",
                "pathname",
                "process",
                "processName",
                "relativeCreated",
                "stack_info",
                "taskName",
                "thread",
                "threadName",
                "service",
                "environment",
                "request_id",
            }:
                continue
            payload[key] = value

        if record.exc_info:
            payload["exc_text"] = _scrub_text(self.formatException(record.exc_info))
        if record.stack_info:
            payload["stack_info"] = _scrub_text(self.formatStack(record.stack_info))

        return json.dumps(payload, default=str, ensure_ascii=False)


class ConsoleFormatter(logging.Formatter):
    """Human-readable single-line format for local development."""

    def format(self, record: logging.LogRecord) -> str:
        request_id = getattr(record, "request_id", "-")
        extras = {
            key: value
            for key, value in record.__dict__.items()
            if key not in logging.LogRecord("", 0, "", 0, "", (), None).__dict__
            and key not in {"message", "asctime", "taskName", "request_id", "service", "environment"}
        }
        suffix = f" {extras}" if extras else ""
        line = f"{record.levelname:<8} [{request_id}] {record.name}: {record.getMessage()}{suffix}"
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return _scrub_text(line)


_CONFIGURED = False


def configure_logging(
    *,
    level: str = "INFO",
    log_format: str = "json",
    service: str = "malihub-api",
    environment: str = "development",
    force: bool = False,
) -> None:
    """Install the root handler. Idempotent unless `force=True`.

    Idempotency matters because this is called from the app's lifespan, and
    `uvicorn --reload` (plus every `TestClient(app)` in the test suite) runs
    that lifespan repeatedly — without the guard each run would add another
    handler and every line would be emitted N times.
    """
    global _CONFIGURED
    if _CONFIGURED and not force:
        return

    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if log_format == "json" else ConsoleFormatter())
    handler.addFilter(RequestContextFilter(service=service, environment=environment))
    handler.addFilter(RedactionFilter())
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Third-party loggers are noisy at INFO and leak connection strings at
    # DEBUG (SQLAlchemy echoes SQL, including bound parameters).
    for noisy in ("uvicorn.access", "httpx", "httpcore", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if level.upper() == "DEBUG" else logging.WARNING
    )

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Logger factory. Prefer module-level `logger = get_logger(__name__)`."""
    return logging.getLogger(name)
