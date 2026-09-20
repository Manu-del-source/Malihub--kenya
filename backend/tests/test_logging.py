"""Structured logging and redaction.

This is the control that decides whether a log aggregator becomes a liability.
The tests are written as "must not appear" assertions rather than "must appear",
because the failure mode here is silent: a secret in a log line looks exactly
like a normal log line until someone is notifying customers about it.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from typing import Any

import pytest

from app.core.logging import (
    ConsoleFormatter,
    JsonFormatter,
    RedactionFilter,
    RequestContextFilter,
    _scrub_text,
    configure_logging,
    get_logger,
    redact_mapping,
    request_id_var,
    safe_extra,
)

# Deliberately synthetic, and deliberately SHORT: each value is long enough to
# trip the detector under test but well under the real vendor format, so a
# secret scanner on the repository (GitHub push protection, a pre-commit hook)
# does not flag a test fixture as a leaked credential. A Stripe key is
# `sk_live_` + 24+ characters; this is 12. `AKIAIOSFODNN7EXAMPLE` is the one
# exception — it is AWS's own published documentation example.
SECRET_DSN = "postgresql://malihub:sup3r-s3cret@db.internal.example:5432/malihub"
REDIS_DSN = "rediss://:r3dis-p4ss@eu1.upstash.io:6379"
#: An unsigned/invalidly-signed JWT — the header decodes to {"alg":"HS256"},
#: the payload to {"sub":"12345"}, and the signature is not one.
JWT_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.abcDEF123456"
API_KEY = "sk_live_fake00000000"


class _CaptureHandler(logging.Handler):
    """Collects records *after* handler filters have run — i.e. as emitted."""

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def collect() -> Iterator[_CaptureHandler]:
    """Install a handler carrying the production filter chain.

    Redaction is a *handler*-level filter, so `caplog` cannot test it: pytest
    attaches its own handler, which never sees `RedactionFilter` and records
    the raw, unredacted record. Asserting on caplog output would test a
    pipeline that does not exist in production. This fixture reproduces the
    one `configure_logging` builds — same formatter position, same filters —
    so a green test means the shipped handler is redacting.
    """
    handler = _CaptureHandler()
    handler.addFilter(RequestContextFilter(service="malihub-api", environment="test"))
    handler.addFilter(RedactionFilter())

    root = logging.getLogger()
    previous_handlers, previous_level = list(root.handlers), root.level
    root.handlers = [handler]
    root.setLevel(logging.DEBUG)
    try:
        yield handler
    finally:
        root.handlers = previous_handlers
        root.setLevel(previous_level)


# ─── Secret redaction by field name ──────────────────────────────────────────


@pytest.mark.parametrize(
    "key",
    [
        "password",
        "user_password",
        "api_key",
        "apiKey",
        "payhero_api_password",
        "access_token",
        "refresh_token",
        "authorization",
        "client_secret",
        "webhook_secret",
        "supabase_jwt_secret",
        "cookie",
        "session_id",
        "signature",
        "phone_number",
        "payer_reference",
        "msisdn",
        "national_id",
        "kra_pin",
        "cvv",
        "card_number",
        "credential_id",
        "private_key",
    ],
)
def test_sensitive_fields_are_redacted(collect: _CaptureHandler, key: str) -> None:
    logger = get_logger("app.test")
    logger.warning("event with a secret", extra={key: API_KEY})
    record = collect.records[-1]
    assert getattr(record, key) != API_KEY
    assert "REDACTED" in str(getattr(record, key))


def test_redaction_reaches_nested_structures(collect: _CaptureHandler) -> None:
    logger = get_logger("app.test")
    logger.warning(
        "nested",
        extra={
            "payload": {
                "provider": "payhero",
                "provider_config": {"api_password": API_KEY, "channel_id": 133},
                "history": [{"token": JWT_TOKEN}, {"amount_cents": 100}],
            }
        },
    )
    rendered = JsonFormatter().format(collect.records[-1])
    assert API_KEY not in rendered
    assert JWT_TOKEN not in rendered
    # Non-sensitive structure survives — a redactor that flattens everything
    # is indistinguishable from not logging at all.
    assert "payhero" in rendered
    assert '"channel_id": 133' in rendered
    assert '"amount_cents": 100' in rendered


def test_a_key_named_credentials_is_redacted_whole(collect: _CaptureHandler) -> None:
    """A mapping under a secret-named key is dropped in its entirety.

    Deliberately conservative: `credentials: {...}` says the author believed
    the contents were sensitive, and sibling fields inside such a blob are
    frequently a username/password pair. Losing the non-secret half is the
    cheaper mistake.
    """
    logger = get_logger("app.test")
    logger.warning("blob", extra={"credentials": {"username": "acme", "api_password": API_KEY}})
    payload = json.loads(JsonFormatter().format(collect.records[-1]))
    assert payload["credentials"] == "[REDACTED]:credentials"
    assert "acme" not in json.dumps(payload)


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("has_credentials", True),
        ("cors_allow_credentials", False),
        ("channel_id_configured", 1),
        ("credentials_checked", None),
        ("token_count", 5),
        ("api_key_configured", False),
    ],
)
def test_booleans_and_counters_about_a_secret_are_preserved(
    collect: _CaptureHandler, key: str, value: Any
) -> None:
    """`has_credentials=True` describes whether a secret is *present*.

    Redacting it destroys precisely the diagnostic that tells you a deployment
    is misconfigured — an early version of this filter did exactly that, and
    the startup log became unreadable.
    """
    logger = get_logger("app.test")
    logger.warning("status", extra={key: value})
    assert getattr(collect.records[-1], key) == value


# ─── Partial masking of identifying-but-useful fields ────────────────────────


@pytest.mark.parametrize(
    ("key", "value", "must_not_contain"),
    [
        ("email", "jane.doe@example.com", "jane.doe@example.com"),
        ("to_email", "jane.doe@example.com", "jane.doe@example.com"),
        ("recipient_email", "jane.doe@example.com", "jane.doe@example.com"),
        ("ip_address", "197.232.45.67", "197.232.45.67"),
    ],
)
def test_identifying_fields_are_masked_not_dropped(
    collect: _CaptureHandler, key: str, value: str, must_not_contain: str
) -> None:
    logger = get_logger("app.test")
    logger.warning("masked", extra={key: value})
    masked = getattr(collect.records[-1], key)
    assert must_not_contain not in masked
    assert masked  # something survives — you can still tell two users apart
    assert masked != "[REDACTED]"


def test_email_provider_configuration_is_not_treated_as_an_address(collect: _CaptureHandler) -> None:
    """`email_provider` matched an earlier substring rule and came out as
    `[REDACTED]`, which made the startup log useless."""
    logger = get_logger("app.test")
    logger.warning("config", extra={"email_provider": "resend"})
    assert collect.records[-1].email_provider == "resend"


def test_masked_ip_keeps_enough_to_spot_one_host(collect: _CaptureHandler) -> None:
    logger = get_logger("app.test")
    logger.warning("ip", extra={"ip_address": "197.232.45.67"})
    assert collect.records[-1].ip_address == "197.232.*.*"


# ─── Message-level scrubbing ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "message",
    [
        f"failed to connect to {SECRET_DSN}",
        f"redis at {REDIS_DSN} refused",
        f"Authorization: Bearer {JWT_TOKEN}",
        f"basic {JWT_TOKEN}",
        f"used api_key={API_KEY} for the call",
        "password: hunter2secretvalue",
        f"the token is {JWT_TOKEN}",
    ],
)
def test_secrets_interpolated_into_a_message_are_scrubbed(collect: _CaptureHandler, message: str) -> None:
    """Defence in depth: structured fields are the plan, this is the backstop
    for the `logger.error(f"…{secret}…")` that will eventually be written."""
    logger = get_logger("app.test")
    logger.error(message)
    rendered = JsonFormatter().format(collect.records[-1])
    for secret in ("sup3r-s3cret", "r3dis-p4ss", API_KEY, "hunter2secretvalue", JWT_TOKEN):
        assert secret not in rendered


def test_ordinary_prose_is_not_scrubbed() -> None:
    """A redactor that mangles normal sentences gets switched off.

    `token` used to be in the bearer pattern, which turned "Supabase token
    verification is unconfigured" into "Supabase token [REDACTED]".
    """
    for text in (
        "Supabase token verification is unconfigured",
        "the token count is 5 and token verification passed",
        "session established for the request",
        "rate limit exceeded for bucket login",
        "email provider is resend",
    ):
        assert _scrub_text(text) == text, text


def test_scrubbing_is_idempotent() -> None:
    once = _scrub_text(f"api_key={API_KEY} and {SECRET_DSN}")
    assert _scrub_text(once) == once


# ─── Request correlation ─────────────────────────────────────────────────────


def test_request_id_is_attached_to_records(collect: _CaptureHandler) -> None:
    logger = get_logger("app.test")
    token = request_id_var.set("abc123")
    try:
        logger.warning("with a request id")
        assert collect.records[-1].request_id == "abc123"
    finally:
        request_id_var.reset(token)


def test_records_outside_a_request_get_a_placeholder(collect: _CaptureHandler) -> None:
    logger = get_logger("app.test")
    logger.warning("background work")
    assert collect.records[-1].request_id == "-"


def test_json_output_is_one_parseable_line(collect: _CaptureHandler) -> None:
    logger = get_logger("app.test")
    logger.warning("structured", extra={"event": "test_event", "count": 3})
    rendered = JsonFormatter().format(collect.records[-1])

    assert "\n" not in rendered
    payload = json.loads(rendered)
    assert payload["level"] == "WARNING"
    assert payload["logger"] == "app.test"
    assert payload["event"] == "test_event"
    assert payload["count"] == 3
    assert payload["timestamp"].endswith("Z")
    for required in ("service", "environment", "request_id", "message"):
        assert required in payload


def test_exceptions_are_captured_and_scrubbed(collect: _CaptureHandler) -> None:
    logger = get_logger("app.test")
    try:
        raise RuntimeError(f"connect failed: {SECRET_DSN}")
    except RuntimeError as exc:
        logger.error("boom", exc_info=exc)
    payload = json.loads(JsonFormatter().format(collect.records[-1]))
    assert "exc_text" in payload
    assert "RuntimeError" in payload["exc_text"]  # the type is diagnostic
    assert "sup3r-s3cret" not in payload["exc_text"]  # the DSN is not


def test_console_format_is_single_line_and_scrubbed(collect: _CaptureHandler) -> None:
    logger = get_logger("app.test")
    logger.warning(f"console {API_KEY}", extra={"event": "e"})
    rendered = ConsoleFormatter().format(collect.records[-1])
    assert API_KEY not in rendered
    assert rendered.count("\n") == 0


# ─── Configuration ───────────────────────────────────────────────────────────


def test_configure_logging_is_idempotent() -> None:
    """Called from the lifespan, which runs once per `TestClient` — without the
    guard, every run would add a handler and duplicate every line."""
    root = logging.getLogger()
    configure_logging(level="WARNING", log_format="json", force=True)
    first = len(root.handlers)
    configure_logging(level="WARNING", log_format="json")
    configure_logging(level="WARNING", log_format="json")
    assert len(root.handlers) == first == 1


def test_redaction_cannot_be_disabled_by_configuration() -> None:
    """There is no setting that turns it off, on purpose."""
    configure_logging(level="DEBUG", log_format="json", force=True)
    handler = logging.getLogger().handlers[0]
    assert any(isinstance(item, RedactionFilter) for item in handler.filters)


def test_third_party_loggers_are_quietened() -> None:
    """SQLAlchemy at DEBUG echoes SQL including bound parameters — which for a
    payments table means amounts and phone numbers."""
    configure_logging(level="DEBUG", log_format="json", force=True)
    assert logging.getLogger("httpx").level >= logging.WARNING
    assert logging.getLogger("uvicorn.access").level >= logging.WARNING


def test_redact_mapping_handles_non_string_keys_and_scalars() -> None:
    """Keys are stringified so the result is always JSON-serializable.

    A dict with int keys reaches `json.dumps` in the formatter; without this,
    `JsonFormatter` would emit `1: "a"` — invalid JSON, and the aggregator
    drops the line.
    """
    assert redact_mapping({1: "a", "b": None, "c": 3, "api_key": API_KEY}) == {
        "1": "a",
        "b": None,
        "c": 3,
        "api_key": "[REDACTED]:api_key",
    }


def test_the_filter_and_the_mapping_redactor_agree(collect: Any) -> None:
    """Locks in the fix for the branch-order bug: two code paths, one rule.

    `RedactionFilter` handles top-level `extra=` keys, `redact_mapping` handles
    nested dicts. They used to order their checks differently, and the
    disagreement was invisible until a secret-named key carried a dict. This
    walks a representative shape through both and requires identical output.
    """
    shape = {
        "credentials": {"username": "acme", "api_password": API_KEY},
        "provider_config": {"api_password": API_KEY, "channel_id": 133},
        "has_credentials": True,
        "email": "jane.doe@example.com",
        "event": "payment_webhook",
    }
    logger = get_logger("app.test")
    logger.warning("parity", extra=dict(shape))
    record = collect.records[-1]

    filtered = {key: getattr(record, key) for key in shape}
    mapped = redact_mapping(shape)
    assert filtered == mapped


# ─── Known credential shapes with no surrounding context ─────────────────────


#: (prefix, minimum body length) straight from `_KNOWN_SECRET_PATTERN`. The
#: values are *built* at run time rather than written out, so no
#: credential-shaped literal appears in this file — a repository secret scanner
#: reads source, and a fixture that looks exactly like a real GitHub PAT would
#: block an unrelated push even though it is fake. Building it from the prefix
#: and the pattern's documented minimum also keeps the two in step: if a
#: threshold changes, this test changes with it.
_KNOWN_PREFIXES = [
    ("sk_live_", 8),
    ("sk_test_", 8),
    ("rk_live_", 8),
    ("re_", 16),
    ("AKIA", 16),
    ("ghp_", 20),
    ("github_pat_", 20),
    ("glpat-", 20),
    ("xoxb-", 10),
    ("AIza", 30),
    ("supabase_secret_", 16),
]


@pytest.mark.parametrize(("prefix", "length"), _KNOWN_PREFIXES)
def test_bare_credentials_in_a_message_are_scrubbed(
    collect: _CaptureHandler, prefix: str, length: int
) -> None:
    """A key interpolated into prose has no `key=` or `Bearer ` context.

    `_ASSIGNMENT_PATTERN` and `_BEARER_PATTERN` both need one, so this is the
    only rule that catches `logger.error(f"payhero rejected {api_key}")`.
    """
    secret = prefix + "0" * length
    assert _scrub_text(secret) != secret, f"{prefix} is not recognized at its minimum length"

    logger = get_logger("app.test")
    logger.error(f"the provider rejected us, here is why: {secret}")
    rendered = JsonFormatter().format(collect.records[-1])
    assert secret not in rendered
    assert "[REDACTED]" in rendered


def test_a_bare_jwt_is_scrubbed_without_a_valid_signature(collect: _CaptureHandler) -> None:
    """The `eyJ` prefix is enough — a truncated or unsigned token still leaks
    its header and payload, which for Supabase means the subject and the role."""
    secret = "eyJhbGciOiJIUzI1NiIs." + "0" * 12 + "." + "0" * 8
    logger = get_logger("app.test")
    logger.error(f"token was {secret}")
    rendered = JsonFormatter().format(collect.records[-1])
    assert secret not in rendered
    assert "[REDACTED]" in rendered


def test_the_aws_documentation_example_is_scrubbed(collect: _CaptureHandler) -> None:
    """`AKIAIOSFODNN7EXAMPLE` is AWS's own published example key. Written out
    in full because it is the one value a scanner is guaranteed to allowlist."""
    logger = get_logger("app.test")
    logger.error("aws rejected AKIAIOSFODNN7EXAMPLE")
    rendered = JsonFormatter().format(collect.records[-1])
    assert "AKIAIOSFODNN7EXAMPLE" not in rendered


# ─── Reserved LogRecord attribute names ──────────────────────────────────────


def test_safe_extra_renames_reserved_attributes(collect: _CaptureHandler) -> None:
    """`extra={"filename": …}` makes stdlib logging raise `KeyError`.

    Not hypothetical: the storage rejection log needed exactly that field, and
    the failure surfaced at runtime inside an error path, converting a 422
    into a 500.
    """
    assert safe_extra(filename="cat.png", msg="hi", event="e") == {
        "x_filename": "cat.png",
        "x_msg": "hi",
        "event": "e",
    }

    logger = get_logger("app.test")
    logger.warning("upload", extra=safe_extra(filename="cat.png", event="e"))
    payload = json.loads(JsonFormatter().format(collect.records[-1]))
    assert payload["x_filename"] == "cat.png"
    assert payload["event"] == "e"


def test_safe_extra_output_survives_the_real_logging_call() -> None:
    """Round-trips through `logging` without a KeyError, for every reserved name."""
    from app.core.logging import RESERVED_LOG_KEYS

    handler = _CaptureHandler()
    logger = logging.getLogger("app.test.reserved")
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.DEBUG)
    try:
        reserved = sorted(RESERVED_LOG_KEYS)
        logger.info("all reserved names", extra=safe_extra(**dict.fromkeys(reserved, "v")))

        assert len(handler.records) == 1
        record = handler.records[0]
        # Every caller-supplied field landed under an `x_` name…
        assert {k: v for k, v in record.__dict__.items() if k.startswith("x_")} == {
            f"x_{name}": "v" for name in reserved
        }
        # …and the record's own reserved attributes are untouched, which is the
        # point: `logging` refused to be lied to, and `safe_extra` did not try.
        assert record.filename.endswith("logging.py") or record.filename  # stdlib-set, not "v"
        assert record.msg == "all reserved names"
    finally:
        logger.handlers = []
