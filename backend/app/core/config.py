"""Typed application configuration.

Single source of truth for every environment variable the backend reads.
Nothing elsewhere in `app/` touches `os.environ` directly — that is the whole
point of this module: one place to see what is configurable, one place to
validate it, and one place to keep a secret out of a log line.

Secrets are declared as `pydantic.SecretStr`, so an accidental
`logger.info("%s", settings)` or an accidental serialization into an API
response renders as `**********` instead of the value.

Env file resolution: `.env` and `.env.local` in the *current working
directory*. Run the server from `backend/` (the npm scripts and
`backend/README.md` do) so `backend/.env` is the file that gets picked up.
Real environment variables always win over the file.
"""

from __future__ import annotations

from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["development", "staging", "production", "test"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["json", "console"]
StorageProviderName = Literal["cloudinary", "none"]
EmailProviderName = Literal["resend", "none"]
PaymentProviderChoice = Literal["PAYHERO", "MANUAL"]

#: Default local frontend origins. Development only — production must set
#: `CORS_ORIGINS` explicitly, and `Settings.validate_for_environment` refuses
#: to boot otherwise. There is no `["*"]` fallback anywhere in this codebase.
DEFAULT_DEV_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)


class ConfigurationError(RuntimeError):
    """Raised when the backend is configured in a way it must not run with.

    Deliberately raised at startup rather than at first use: a misconfigured
    production deployment should fail loudly and immediately, not serve
    traffic that silently skips a security check.
    """


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ─── Application ────────────────────────────────────────────────────────
    app_name: str = "MaliHub Kenya API"
    app_version: str = "0.8.0"
    environment: Environment = "development"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    #: Bind address for `python -m uvicorn`. 0.0.0.0 so the app is reachable
    #: from outside a container; put a reverse proxy in front of it in
    #: production rather than binding to a public interface directly.
    host: str = "0.0.0.0"  # noqa: S104 — see docstring above.
    port: int = 8000
    #: Absolute public URL of this backend. Providers that call back (PayHero's
    #: `callback_url`) need a publicly reachable address, and it cannot be
    #: derived from a request behind a proxy.
    backend_public_url: str = "http://localhost:8000"
    #: OpenAPI/Swagger UI. On by default in development, forced off in
    #: production by `validate_for_environment` unless explicitly re-enabled —
    #: a public schema of every route is reconnaissance gift-wrapping.
    enable_docs: bool = True

    # ─── Logging ────────────────────────────────────────────────────────────
    log_level: LogLevel = "INFO"
    log_format: LogFormat = "json"
    #: Echo SQL. Never enable in production: it writes payment amounts, phone
    #: numbers and email addresses straight into the log stream, which is
    #: exactly what the redaction layer in core/logging.py exists to prevent.
    database_echo: bool = False

    # ─── PostgreSQL (application database) ──────────────────────────────────
    #: Standard Postgres DSN. Any provider works (Neon, RDS, Cloud SQL,
    #: Supabase, self-hosted) — nothing here assumes a Supabase-specific
    #: extension. Accepts `postgres://`, `postgresql://`, and the SQLAlchemy
    #: async forms; normalized to `postgresql+asyncpg://` below.
    database_url: SecretStr | None = None
    database_pool_size: int = Field(default=5, ge=1, le=100)
    database_max_overflow: int = Field(default=10, ge=0, le=100)
    database_pool_timeout_seconds: int = Field(default=30, ge=1, le=300)
    database_pool_recycle_seconds: int = Field(default=1800, ge=30, le=86_400)

    # ─── Redis (cache / rate limiting / temporary state) ────────────────────
    #: Standard Redis DSN (`redis://` / `rediss://`). Point this at the *same*
    #: Upstash database the Next.js app uses via its TCP endpoint, and both
    #: stacks share one Redis — see ARCHITECTURE.md §10. Not a primary
    #: datastore; nothing durable may live here.
    redis_url: SecretStr | None = None
    redis_max_connections: int = Field(default=20, ge=1, le=500)
    redis_socket_timeout_seconds: float = Field(default=2.0, gt=0, le=30)
    #: Root namespace for every key this backend writes. Matches the Next.js
    #: side's `malihub:` prefix so both stacks live in one keyspace without
    #: colliding (backend keys nest under `malihub:api:`).
    redis_key_prefix: str = "malihub"
    rate_limit_enabled: bool = True
    #: Mirrors the Phase 7 `api` bucket in src/lib/rate-limit.ts (120 req/min)
    #: so the two stacks impose comparable limits.
    rate_limit_requests_per_minute: int = Field(default=120, ge=1, le=100_000)
    #: Same deliberate trade-off Phase 7 documented: a Redis outage degrades
    #: to "no rate limiting" rather than "every request 500s". Set false to
    #: fail closed instead.
    rate_limit_fail_open: bool = True

    # ─── CORS ───────────────────────────────────────────────────────────────
    #: Comma-separated list of exact browser origins allowed to call this API.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: list(DEFAULT_DEV_CORS_ORIGINS)
    )
    #: Optional escape hatch for preview deployments with generated hostnames.
    #: Anchored automatically; leave unset unless you need it.
    cors_origin_regex: str | None = None
    cors_allow_credentials: bool = True
    cors_allow_methods: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
    )
    cors_allow_headers: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["Authorization", "Content-Type", "X-Request-ID"]
    )
    cors_max_age_seconds: int = Field(default=600, ge=0, le=86_400)
    #: Public URL of the Next.js frontend. Used as a CORS origin fallback in
    #: development and to build links inside transactional email.
    frontend_url: str = "http://localhost:3000"

    # ─── Supabase (AUTHENTICATION ONLY) ─────────────────────────────────────
    #: Supabase is MaliHub's identity provider and nothing else. This backend
    #: verifies tokens Supabase issued; it never stores a password, never runs
    #: its own signup/login, and never uses the service-role key. See
    #: core/security.py and ARCHITECTURE.md §5b.
    supabase_url: str | None = None
    supabase_anon_key: SecretStr | None = None
    #: The project's JWT signing secret (Dashboard → Settings → API). Used for
    #: HS256 verification, which is how Supabase signs access tokens for
    #: projects on the legacy shared secret.
    supabase_jwt_secret: SecretStr | None = None
    #: Projects that have moved to asymmetric signing expose a JWKS endpoint
    #: instead. Setting this switches verification to JWKS and requires the
    #: `jwks` extra (`pip install '.[jwks]'`, which pulls in `cryptography`).
    supabase_jwks_url: str | None = None
    supabase_jwt_algorithms: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["HS256"])
    #: Expected `iss`. Defaults to `{supabase_url}/auth/v1`, which is what
    #: Supabase puts in the claim; override only if you know you need to.
    supabase_jwt_issuer: str | None = None
    supabase_jwt_audience: str = "authenticated"
    #: Accepted clock skew, in seconds. Small on purpose — a large leeway
    #: widens the window a stolen token stays usable.
    jwt_leeway_seconds: int = Field(default=30, ge=0, le=300)

    # ─── Email (Resend) ─────────────────────────────────────────────────────
    email_provider: EmailProviderName = "resend"
    resend_api_key: SecretStr | None = None
    email_from: str = "MaliHub Kenya <notifications@malihub.co.ke>"
    email_reply_to: str | None = None
    resend_base_url: str = "https://api.resend.com"
    email_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    # ─── Storage (external provider, never Supabase Storage) ────────────────
    storage_provider: StorageProviderName = "cloudinary"
    cloudinary_cloud_name: str | None = None
    cloudinary_api_key: SecretStr | None = None
    cloudinary_api_secret: SecretStr | None = None
    cloudinary_base_url: str = "https://api.cloudinary.com/v1_1"
    cloudinary_secure_base_url: str = "https://res.cloudinary.com"
    #: Folder everything lands under, so a stray upload can't be written to the
    #: root of the cloud and so `public_url` can prove a URL is ours — the same
    #: property src/lib/validations/upload-security.ts enforces on the
    #: frontend.
    cloudinary_folder: str = "malihub"
    storage_timeout_seconds: float = Field(default=20.0, gt=0, le=120)
    #: Hard ceiling on a single upload, in bytes. Mirrors the frontend's
    #: `MAX_UPLOAD_BYTES` so the two layers agree.
    storage_max_upload_bytes: int = Field(default=8 * 1024 * 1024, ge=1, le=100 * 1024 * 1024)

    # ─── Payments ───────────────────────────────────────────────────────────
    #: Provider used when a caller doesn't name one. `DARAJA` is deliberately
    #: NOT a valid choice here: it exists in the Prisma enum as a reserved
    #: value for a future provider and has no implementation.
    payments_default_provider: PaymentProviderChoice = "PAYHERO"

    # PayHero — first payment provider. Placeholders only in Phase 8: no
    # PayHero request is made anywhere in this codebase yet (see
    # providers/payments/payhero.py). Real credentials belong in Phase 9.
    payhero_enabled: bool = False
    payhero_api_username: SecretStr | None = None
    payhero_api_password: SecretStr | None = None
    #: PayHero v2 API root, per https://docs.payhero.co.ke. Phase 9 must
    #: confirm the sandbox/testing host against PayHero's current docs before
    #: pointing this at a test account.
    payhero_base_url: str = "https://backend.payhero.co.ke/api/v2"
    #: PayHero's registered payment channel ID (Dashboard → Payment Channels).
    #: An integer on PayHero's side; kept as a string here so an unset value is
    #: unambiguous and nothing tries to do arithmetic on it.
    payhero_channel_id: str | None = None
    #: PayHero's own `provider` request field — the rail *within* PayHero
    #: (e.g. `m-pesa`). Not the same concept as our `PaymentProvider` enum,
    #: which identifies the processor. Easy to conflate; hence the name.
    payhero_default_channel_provider: str = "m-pesa"
    #: Optional: use our own Daraja credentials through PayHero instead of
    #: theirs. Leave unset unless that's a deliberate decision in Phase 9.
    payhero_credential_id: str | None = None
    payhero_timeout_seconds: float = Field(default=15.0, gt=0, le=120)
    #: Shared secret PayHero signs callbacks with, if/when enabled on the
    #: account. Phase 9 must refuse an unsigned or unverifiable callback.
    payhero_webhook_secret: SecretStr | None = None

    # ─── Derived helpers ────────────────────────────────────────────────────

    @field_validator(
        "cors_origins", "cors_allow_methods", "cors_allow_headers", "supabase_jwt_algorithms", mode="before"
    )
    @classmethod
    def _split_comma_separated(cls, value: object) -> object:
        """Accept `A,B,C` from the environment as well as a real list.

        These four fields are annotated `NoDecode`, which stops
        `pydantic-settings` from trying to JSON-parse the env var before
        validation runs. Without it, `CORS_ORIGINS=https://a.com,https://b.com`
        raises `SettingsError: error parsing value for field "cors_origins"` —
        because it is not valid JSON, and demanding JSON in `.env` is exactly
        the papercut that leads someone to write `CORS_ORIGINS=*` instead.

        Comma-separated is also the convention the rest of this project uses.
        """
        if isinstance(value, str):
            parts = [part.strip() for part in value.split(",")]
            return [part for part in parts if part]
        return value

    @field_validator("cors_origins")
    @classmethod
    def _normalize_origins(cls, origins: list[str]) -> list[str]:
        cleaned: list[str] = []
        for origin in origins:
            if origin == "*":
                # Refused outright rather than warned about. A wildcard with
                # allow_credentials=True is rejected by browsers anyway, and
                # without credentials it would let any site script this API on
                # a logged-in user's behalf.
                raise ConfigurationError(
                    "CORS_ORIGINS must not contain '*'. List the exact origins "
                    "allowed to call this API (e.g. https://malihub.co.ke)."
                )
            normalized = origin.rstrip("/")
            parsed = urlparse(normalized)
            if not parsed.scheme or not parsed.netloc:
                raise ConfigurationError(
                    f"CORS_ORIGINS entry {origin!r} is not a valid origin "
                    "(expected scheme + host, e.g. https://app.example.com)."
                )
            if normalized not in cleaned:
                cleaned.append(normalized)
        return cleaned

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_database_url(cls, value: object) -> object:
        """Rewrite a plain Postgres DSN into SQLAlchemy's asyncpg dialect.

        Providers hand out `postgres://...` (Heroku-style) or
        `postgresql://...`; async SQLAlchemy needs `postgresql+asyncpg://`.
        Normalizing here means the same `DATABASE_URL` the Next.js app uses can
        be pasted straight into `backend/.env` without edits.
        """
        if not isinstance(value, str) or not value.strip():
            return value
        url = value.strip()
        if url.startswith("postgresql+asyncpg://"):
            return url
        # `postgres+asyncpg://` is a valid SQLAlchemy alias, but canonicalizing
        # to one spelling means log lines, error messages and `psql` commands
        # all quote the same string.
        if url.startswith("postgres+asyncpg://"):
            return url.replace("postgres+asyncpg://", "postgresql+asyncpg://", 1)
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        raise ConfigurationError(
            "DATABASE_URL must be a Postgres connection string starting with "
            "'postgres://' or 'postgresql://'."
        )

    @model_validator(mode="after")
    def _derive_defaults(self) -> Settings:
        if not self.supabase_jwt_issuer and self.supabase_url:
            self.supabase_jwt_issuer = f"{self.supabase_url.rstrip('/')}/auth/v1"
        if not self.supabase_jwks_url and self.supabase_url:
            # Only *derived* as a convenience; JWKS verification still requires
            # `supabase_jwt_algorithms` to name an asymmetric algorithm, so
            # deriving the URL cannot silently switch the verification mode.
            self.supabase_jwks_url = f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        return self

    # ─── Convenience ────────────────────────────────────────────────────────

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def is_test(self) -> bool:
        return self.environment == "test"

    @property
    def jwt_verification_mode(self) -> Literal["hs256", "jwks", "unconfigured"]:
        """Which Supabase token verification path is usable, if any."""
        algorithms = {algorithm.upper() for algorithm in self.supabase_jwt_algorithms}
        if algorithms & {"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"}:
            return "jwks" if self.supabase_jwks_url else "unconfigured"
        if self.supabase_jwt_secret:
            return "hs256"
        return "unconfigured"

    def redis_key(self, *parts: str) -> str:
        """Build a namespaced Redis key: `malihub:api:ratelimit:v1:<bucket>`."""
        joined = ":".join(part.strip(":") for part in parts if part)
        return f"{self.redis_key_prefix}:{joined}"

    def payhero_callback_url(self, path: str) -> str:
        """Absolute callback URL handed to a payment provider."""
        return f"{self.backend_public_url.rstrip('/')}/{path.lstrip('/')}"

    def validate_for_environment(self) -> list[str]:
        """Check config against the target environment. Returns warnings.

        Raises `ConfigurationError` for anything that must not run at all;
        returns a list of human-readable warnings for things that are merely
        degraded. Called from the app's lifespan so problems surface at boot
        with the whole picture, not one 500 at a time later.
        """
        warnings: list[str] = []

        if self.is_production:
            # Both branches matter. An *empty* list is the obvious mistake; the
            # subtler one is leaving CORS_ORIGINS unset entirely, which silently
            # yields the local-development defaults — so a deployed API would
            # accept calls from http://localhost:3000 and reject the real
            # frontend. `model_fields_set` distinguishes "explicitly configured"
            # from "fell through to the default".
            if not self.cors_origins or "cors_origins" not in self.model_fields_set:
                raise ConfigurationError(
                    "CORS_ORIGINS must be set explicitly in production. It defaults "
                    "to local development origins (http://localhost:3000), which is "
                    "never right for a deployed API — list the exact frontend "
                    "origin(s). There is no wildcard fallback."
                )
            if self.debug:
                raise ConfigurationError("DEBUG must be false in production.")
            if self.enable_docs:
                raise ConfigurationError(
                    "ENABLE_DOCS must be false in production (set ENABLE_DOCS=false). "
                    "The OpenAPI schema should not be publicly enumerable."
                )
            if self.database_echo:
                raise ConfigurationError("DATABASE_ECHO must be false in production (it logs row data).")
            if self.jwt_verification_mode == "unconfigured":
                raise ConfigurationError(
                    "Supabase token verification is not configured. Set "
                    "SUPABASE_JWT_SECRET (HS256) or SUPABASE_JWKS_URL plus an "
                    "asymmetric SUPABASE_JWT_ALGORITHMS entry."
                )
            if not self.database_url:
                raise ConfigurationError("DATABASE_URL is required in production.")
            if self.backend_public_url.startswith("http://localhost"):
                raise ConfigurationError(
                    "BACKEND_PUBLIC_URL must be this backend's public https:// URL "
                    "in production — payment providers call back to it."
                )

        if not self.database_url:
            warnings.append("DATABASE_URL is not set — database-dependent routes will return 503.")
        if not self.redis_url:
            warnings.append(
                "REDIS_URL is not set — rate limiting and caching are disabled "
                f"(fail_open={self.rate_limit_fail_open}). Required in production."
            )
        if self.jwt_verification_mode == "unconfigured":
            warnings.append(
                "Supabase token verification is unconfigured — every authenticated "
                "route will return 503 until SUPABASE_JWT_SECRET or JWKS is set."
            )
        if self.payhero_enabled and not (self.payhero_api_username and self.payhero_api_password):
            raise ConfigurationError(
                "PAYHERO_ENABLED=true requires PAYHERO_API_USERNAME and "
                "PAYHERO_API_PASSWORD. Note that Phase 8 does not implement the "
                "PayHero client — enabling it produces 501s, not payments."
            )
        if not self.resend_api_key:
            warnings.append("RESEND_API_KEY is not set — transactional email is disabled.")
        if self.storage_provider == "cloudinary" and not self.cloudinary_cloud_name:
            warnings.append(
                "CLOUDINARY_CLOUD_NAME is not set — the storage provider cannot "
                "build or validate public URLs."
            )
        return warnings


_cached_settings: Settings | None = None


def get_settings() -> Settings:
    """Process-wide settings, constructed once.

    Cached because `Settings()` reads the environment and any `.env` file on
    every construction, and this is a FastAPI dependency on several routes —
    doing that per request would be pointless repeated I/O.

    Not `functools.lru_cache`: an explicit cache can be *primed*, which is what
    lets `create_app(settings)` and a route's `Depends(get_settings)` resolve to
    the same object. With `lru_cache` the first caller wins and a test (or a
    second app in one process) silently gets someone else's configuration.
    """
    global _cached_settings
    if _cached_settings is None:
        _cached_settings = Settings()
    return _cached_settings


def set_settings(settings: Settings | None) -> None:
    """Install settings as the process-wide instance, or clear them with None.

    Used by `create_app()` so the app and its route dependencies agree, and by
    the test suite. Production code has no reason to call it — configuration is
    read from the environment once, at startup.
    """
    global _cached_settings
    _cached_settings = settings


def reset_settings() -> None:
    """Drop the cached settings so the next `get_settings()` re-reads the env."""
    set_settings(None)
