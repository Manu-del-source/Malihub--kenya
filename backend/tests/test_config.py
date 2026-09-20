"""Configuration: parsing, normalization, and the production boot gate.

The production cases are the important ones. A deployment that boots with no
CORS origins, docs enabled, or no token verification is a deployment running
with a security control silently off — and silent is the expensive part, because
nothing reports it until something goes wrong. `validate_for_environment()`
converts each of those into a crash-loop with a message naming the variable.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.core.config import DEFAULT_DEV_CORS_ORIGINS, ConfigurationError
from tests.conftest import build_settings

# ─── Parsing ─────────────────────────────────────────────────────────────────


def test_comma_separated_lists_are_parsed() -> None:
    settings = build_settings(cors_origins="https://a.example, https://b.example")
    assert settings.cors_origins == ["https://a.example", "https://b.example"]


def test_cors_origins_have_trailing_slashes_stripped_and_duplicates_removed() -> None:
    settings = build_settings(cors_origins="https://a.example/,https://a.example")
    assert settings.cors_origins == ["https://a.example"]


def test_empty_cors_entries_are_dropped() -> None:
    settings = build_settings(cors_origins="https://a.example,,  ,https://b.example")
    assert settings.cors_origins == ["https://a.example", "https://b.example"]


def test_development_defaults_to_localhost_origins() -> None:
    """With CORS_ORIGINS unset, development still gets usable local origins."""
    settings = build_settings(cors_origins=None)
    assert settings.cors_origins == list(DEFAULT_DEV_CORS_ORIGINS)


def test_production_rejects_the_development_origin_default() -> None:
    """Leaving CORS_ORIGINS unset in production must fail, not fall through.

    The default is `http://localhost:3000` — so the subtle failure mode is a
    deployed API that accepts calls from a developer's laptop and rejects the
    real frontend. Requiring the field to be *explicitly* set closes it.
    """
    settings = build_settings(**{**PRODUCTION_BASE, "cors_origins": None})
    with pytest.raises(ConfigurationError, match="must be set explicitly in production"):
        settings.validate_for_environment()


# ─── Wildcard refusal ────────────────────────────────────────────────────────


@pytest.mark.parametrize("value", ["*", "https://a.example,*", " * "])
def test_wildcard_cors_origin_is_rejected_outright(value: str) -> None:
    """`allow_origins=["*"]` is unreachable from configuration.

    Not a warning and not a fallback: a literal `*` raises while parsing, so no
    code path anywhere can produce a wildcard CORS policy.
    """
    with pytest.raises(ConfigurationError, match=r"must not contain '\*'"):
        build_settings(cors_origins=value)


def test_malformed_origin_is_rejected() -> None:
    with pytest.raises(ConfigurationError, match="not a valid origin"):
        build_settings(cors_origins="localhost:3000")  # missing scheme


# ─── DSN normalization ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected_prefix"),
    [
        ("postgres://u:p@h:5432/db", "postgresql+asyncpg://u:p@h:5432/db"),
        ("postgresql://u:p@h:5432/db", "postgresql+asyncpg://u:p@h:5432/db"),
        ("postgresql+asyncpg://u:p@h:5432/db", "postgresql+asyncpg://u:p@h:5432/db"),
        ("postgres+asyncpg://u:p@h:5432/db", "postgresql+asyncpg://u:p@h:5432/db"),
    ],
)
def test_database_url_is_normalized_for_asyncpg(raw: str, expected_prefix: str) -> None:
    """The same DSN the Next.js app uses works here without edits."""
    settings = build_settings(database_url=raw)
    assert settings.database_url is not None
    assert settings.database_url.get_secret_value() == expected_prefix


def test_non_postgres_database_url_is_rejected() -> None:
    with pytest.raises(ConfigurationError, match="Postgres connection string"):
        build_settings(database_url="mysql://u:p@h/db")


def test_database_url_is_a_secret() -> None:
    """`SecretStr` so an accidental interpolation cannot print the password."""
    settings = build_settings(database_url="postgresql://u:sup3rsecret@h:5432/db")
    assert "sup3rsecret" not in str(settings.database_url)
    assert "sup3rsecret" not in repr(settings)


def test_redis_url_is_a_secret() -> None:
    settings = build_settings(redis_url="redis://:sup3rsecret@h:6379/0")
    assert "sup3rsecret" not in str(settings.redis_url)


# ─── Supabase derivation ─────────────────────────────────────────────────────


def test_jwt_issuer_and_jwks_url_derive_from_supabase_url() -> None:
    settings = build_settings(supabase_url="https://xyz.supabase.co/")
    assert settings.supabase_jwt_issuer == "https://xyz.supabase.co/auth/v1"
    assert settings.supabase_jwks_url == "https://xyz.supabase.co/auth/v1/.well-known/jwks.json"


def test_verification_mode_follows_configuration() -> None:
    assert build_settings().jwt_verification_mode == "unconfigured"
    assert build_settings(supabase_jwt_secret="s3cret").jwt_verification_mode == "hs256"
    assert (
        build_settings(
            supabase_url="https://xyz.supabase.co",
            supabase_jwt_algorithms="RS256",
        ).jwt_verification_mode
        == "jwks"
    )


def test_deriving_the_jwks_url_does_not_switch_the_verification_mode() -> None:
    """A convenience default must not silently change how tokens are verified."""
    settings = build_settings(supabase_url="https://xyz.supabase.co", supabase_jwt_secret="s3cret")
    assert settings.supabase_jwks_url  # derived
    assert settings.jwt_verification_mode == "hs256"  # but not used


# ─── Redis key namespacing ───────────────────────────────────────────────────


def test_redis_keys_share_the_frontend_namespace() -> None:
    """Both stacks live in one keyspace without colliding."""
    settings = build_settings()
    assert settings.redis_key("api", "ratelimit", "v1", "login") == "malihub:api:ratelimit:v1:login"


def test_payhero_callback_url_is_absolute() -> None:
    settings = build_settings(backend_public_url="https://api.malihub.co.ke/")
    assert (
        settings.payhero_callback_url("api/v1/payments/webhooks/payhero")
        == "https://api.malihub.co.ke/api/v1/payments/webhooks/payhero"
    )


# ─── Production boot gate ────────────────────────────────────────────────────

PRODUCTION_BASE = {
    "environment": "production",
    "debug": False,
    "enable_docs": False,
    "database_echo": False,
    "cors_origins": "https://malihub.co.ke",
    "database_url": "postgresql://u:p@h:5432/db",
    "redis_url": "redis://h:6379/0",
    "backend_public_url": "https://api.malihub.co.ke",
    "supabase_jwt_secret": "not-a-real-secret-0123456789abcdef0123456789",
}


def test_valid_production_configuration_passes_with_no_fatal_errors() -> None:
    settings = build_settings(**PRODUCTION_BASE)
    # Does not raise: every control that must be on, is.
    warnings = settings.validate_for_environment()
    joined = " ".join(warnings)
    # The critical services are configured, so none of them warn. Resend and
    # Cloudinary are absent from PRODUCTION_BASE and do — degraded, not fatal.
    for critical in ("DATABASE_URL", "REDIS_URL", "SUPABASE_JWT_SECRET"):
        assert critical not in joined
    assert "RESEND_API_KEY" in joined


@pytest.mark.parametrize(
    ("override", "match"),
    [
        ({"debug": True}, "DEBUG must be false"),
        ({"enable_docs": True}, "ENABLE_DOCS must be false"),
        ({"database_echo": True}, "DATABASE_ECHO must be false"),
        ({"cors_origins": ""}, "must be set explicitly in production"),
        ({"database_url": ""}, "DATABASE_URL is required in production"),
        ({"supabase_jwt_secret": ""}, "token verification is not configured"),
        ({"backend_public_url": "http://localhost:8000"}, "BACKEND_PUBLIC_URL must be"),
    ],
)
def test_production_refuses_to_boot_with_a_control_disabled(override: dict, match: str) -> None:
    settings = build_settings(**{**PRODUCTION_BASE, **override})
    with pytest.raises(ConfigurationError, match=match):
        settings.validate_for_environment()


def test_payhero_enabled_without_credentials_is_fatal() -> None:
    """Enabling a provider with no credentials must fail loudly, not 501 later."""
    settings = build_settings(payhero_enabled=True)
    with pytest.raises(ConfigurationError, match="PAYHERO_ENABLED=true requires"):
        settings.validate_for_environment()


def test_missing_optional_services_warn_rather_than_fail() -> None:
    settings = build_settings()  # development, nothing configured
    warnings = settings.validate_for_environment()
    joined = " ".join(warnings)
    assert "DATABASE_URL" in joined
    assert "REDIS_URL" in joined
    assert "RESEND_API_KEY" in joined
    assert "CLOUDINARY_CLOUD_NAME" in joined


def test_out_of_range_values_are_rejected() -> None:
    with pytest.raises(PydanticValidationError):
        build_settings(rate_limit_requests_per_minute=0)
    with pytest.raises(PydanticValidationError):
        build_settings(jwt_leeway_seconds=9999)


def test_payment_default_provider_cannot_be_daraja() -> None:
    """Daraja is reserved in the schema and has no adapter.

    Declaring it as a `Literal` that excludes DARAJA means the misconfiguration
    is caught at parse time, rather than at a customer's checkout.
    """
    with pytest.raises(PydanticValidationError):
        build_settings(payments_default_provider="DARAJA")
