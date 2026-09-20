"""Authentication: verify tokens Supabase issued. Nothing else.

**Supabase is MaliHub's identity provider.** This module contains no password
handling, no user table, no signup, no login, no session store, and no way to
mint a token. It takes a JWT that Supabase's Auth server already signed and
answers one question: *is this a valid, unexpired token for a real user, and
what does it say about them?*

That boundary is the reason the backend can exist without becoming a second
authentication system — the failure mode where two services each own half of
"who is this user" and drift apart. Login/signup stay in the Next.js app
(`src/lib/supabase/*`, `src/app/(auth)/*`); the frontend forwards the Supabase
access token it already holds as `Authorization: Bearer <token>`.

Two claims deserve particular care, and both are traps:

* `role` in a Supabase JWT is the **Postgres** role (`anon`, `authenticated`,
  `service_role`) — not MaliHub's application role. Reading it as an app role
  makes every logged-in user identical, or makes an admin check pass for
  whoever holds the service key. The application role lives in
  `app_metadata.role`, which is what `src/middleware.ts` reads and what
  `AuthContext.role` exposes here.
* A `service_role` token is a god-mode credential that bypasses RLS. This
  verifier **rejects** it. Accepting one as a user token would let anything
  holding the service key act as an arbitrary user — and if `role` were
  (mis)read as the app role, as a SUPER_ADMIN.

What is *not* implemented here, deliberately:

* **Token revocation / logout propagation.** Supabase access tokens are
  short-lived (1 hour by default) and this verifier is stateless, so a banned
  user keeps a working token until it expires. Closing that fully means a
  per-request check against Supabase (`auth.admin.get_user_by_id`) or a
  denylist in Redis — both are latency/consistency trade-offs that belong with
  the authorization work in a later phase, not here. `AuthContext.is_banned` is
  not guessed at; ban enforcement stays where it already is (RLS + the
  Next.js middleware + explicit service-layer checks).
* **Refresh.** Refresh tokens are for the frontend's Supabase client, never for
  this API. A 401 here means "ask Supabase for a fresh token and retry".
"""

from __future__ import annotations

import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from fastapi import Depends, Request

from app.core.config import Settings, get_settings
from app.core.errors import ForbiddenError, ServiceUnavailableError, UnauthorizedError
from app.core.logging import get_logger

logger = get_logger(__name__)

#: Postgres roles that appear in a Supabase JWT's `role` claim. `service_role`
#: must never be accepted as a user token — see the module docstring.
SUPABASE_POSTGRES_ROLES = frozenset({"anon", "authenticated", "service_role"})

#: Application roles, matching the `UserRole` enum in prisma/schema.prisma.
APP_ROLES = frozenset({"BUYER", "SELLER", "ADMIN", "SUPER_ADMIN"})

STAFF_ROLES = frozenset({"ADMIN", "SUPER_ADMIN"})


@dataclass(frozen=True, slots=True)
class AuthContext:
    """Who a verified request belongs to, as far as this backend needs to know.

    Frozen and slot-backed: an identity object that can be mutated mid-request
    by a handler is an authorization bug waiting to happen.
    """

    #: Supabase `auth.users.id`, which is also `public.users.id` — the two
    #: share a primary key by design (see prisma/schema.prisma's `User`).
    subject: str
    email: str | None = None
    phone: str | None = None
    #: Application role from `app_metadata.role`. Falls back to `BUYER`, the
    #: same default `public.jwt_role()` uses in the RLS policies, so the two
    #: layers never disagree about an un-roled user.
    role: str = "BUYER"
    is_onboarded: bool = False
    has_seller_profile: bool = False
    email_confirmed: bool = False
    #: Supabase `jti`, if present. The handle for a future revocation denylist.
    token_id: str | None = None
    issued_at: int | None = None
    expires_at: int | None = None
    #: Raw claims, for the rare handler that needs something not modelled here.
    #: Read-only by convention; nothing should branch on this when a typed
    #: field exists.
    claims: dict[str, Any] = field(default_factory=dict)

    @property
    def is_staff(self) -> bool:
        return self.role in STAFF_ROLES

    @property
    def is_authenticated(self) -> bool:
        return True


@runtime_checkable
class TokenVerifier(Protocol):
    """The seam between "a request arrived" and "we know who sent it".

    Anything implementing this can back the API's auth dependency — Supabase
    JWTs today, a different issuer later, a test double in the suite. Keeping
    it a Protocol (not a base class) means the implementations don't have to
    share an inheritance tree they have nothing in common with.
    """

    async def verify(self, token: str) -> AuthContext:
        """Return an `AuthContext` or raise `UnauthorizedError`. Never None."""
        ...

    @property
    def is_configured(self) -> bool:
        """False means every authenticated route will 503, not silently pass."""
        ...


class UnconfiguredVerifier:
    """Fails closed. Used when Supabase verification isn't configured.

    This class exists so that a missing `SUPABASE_JWT_SECRET` produces a loud
    503 rather than an anonymous request that some downstream handler forgets
    to check. Fail-open authentication is the one default that is never
    acceptable.
    """

    is_configured = False

    async def verify(self, token: str) -> AuthContext:
        logger.error(
            "auth_not_configured",
            extra={
                "event": "auth_not_configured",
                "detail": "A request presented a bearer token but Supabase verification is unconfigured.",
            },
        )
        raise ServiceUnavailableError(
            "Authentication is not configured on this service. "
            "Set SUPABASE_JWT_SECRET (or SUPABASE_JWKS_URL) on the backend."
        )


class SupabaseJwtVerifier:
    """Verify Supabase-issued JWTs.

    Supports both signing configurations Supabase ships:

    * **HS256 with the project's JWT secret** — the default for projects on the
      legacy shared secret. Set `SUPABASE_JWT_SECRET`.
    * **Asymmetric (RS256/ES256) via JWKS** — newer Supabase projects sign with
      a rotating key pair published at
      `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. Set
      `SUPABASE_JWT_ALGORITHMS=RS256` and install the `jwks` extra
      (`pip install '.[jwks]'`) for `cryptography`.

    The algorithm set is *pinned from configuration*, never read from the
    token's own header. That is what prevents the two classic JWT attacks:
    `alg: none`, and algorithm confusion (re-signing an RS256 token with the
    public key as an HMAC secret). PyJWT enforces the pin for us, but only
    because we hand it an explicit allow-list.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._jwks_client: Any | None = None
        self._jwks_checked = False
        self._algorithms = tuple(algorithm.upper() for algorithm in self._settings.supabase_jwt_algorithms)
        self._mode = self._settings.jwt_verification_mode

    @property
    def is_configured(self) -> bool:
        return self._mode != "unconfigured"

    @property
    def mode(self) -> str:
        return self._mode

    async def verify(self, token: str) -> AuthContext:
        if not self.is_configured:
            # Shouldn't happen (the factory returns UnconfiguredVerifier), but
            # belt-and-braces: never fall through to a decode with no key.
            raise ServiceUnavailableError("Authentication is not configured on this service.")

        if not token or not isinstance(token, str):
            raise UnauthorizedError("Authentication required.")

        claims = self._decode(token)
        return self._to_context(claims)

    def _decode(self, token: str) -> dict[str, Any]:
        import jwt
        from jwt import PyJWTError

        settings = self._settings
        options = {
            "verify_signature": True,
            "verify_exp": True,
            "verify_nbf": True,
            "verify_iat": True,
            "verify_aud": bool(settings.supabase_jwt_audience),
            "verify_iss": bool(settings.supabase_jwt_issuer),
            # A JWT with no subject cannot identify a user; refuse it rather
            # than produce an AuthContext with an empty id.
            "require": ["exp", "sub"],
        }
        decode_kwargs: dict[str, Any] = {
            "algorithms": list(self._algorithms),
            "options": options,
            "leeway": settings.jwt_leeway_seconds,
        }
        if settings.supabase_jwt_audience:
            decode_kwargs["audience"] = settings.supabase_jwt_audience
        if settings.supabase_jwt_issuer:
            decode_kwargs["issuer"] = settings.supabase_jwt_issuer

        try:
            if self._mode == "jwks":
                signing_key = self._jwks_signing_key(token)
                return jwt.decode(token, signing_key, **decode_kwargs)
            secret = settings.supabase_jwt_secret
            if secret is None:
                # Unreachable by construction: `jwt_verification_mode` only
                # reports "hs256" when a secret is present. Checked rather than
                # asserted because the alternative under `python -O` is an
                # AttributeError inside token verification — and failing open
                # there is not an option, so this has to fail closed and loud.
                raise ServiceUnavailableError(
                    "Token verification is misconfigured on this server.",
                    details={"reason": "hs256_mode_without_secret"},
                )
            return jwt.decode(token, secret.get_secret_value(), **decode_kwargs)
        except PyJWTError as exc:
            # The exception *type* is logged, never the token and never the
            # exception message for signature failures: PyJWT's messages are
            # specific enough ("signature mismatch" vs "expired") that
            # reflecting them to a caller turns this endpoint into an oracle for
            # iterating on a forgery. The client gets one generic 401.
            logger.info(
                "auth_token_rejected",
                extra={
                    "event": "auth_token_rejected",
                    "reason": type(exc).__name__,
                    "mode": self._mode,
                },
            )
            raise UnauthorizedError("Authentication required.") from exc

    def _jwks_signing_key(self, token: str) -> Any:
        """Fetch (and cache) the JWKS signing key for this token's `kid`."""
        if self._jwks_client is None:
            try:
                from jwt import PyJWKClient
            except ImportError as exc:  # pragma: no cover - depends on extras
                raise ServiceUnavailableError(
                    "JWKS-based token verification needs the 'jwks' extra. "
                    "Install it with: pip install '.[jwks]' (or set "
                    "SUPABASE_JWT_SECRET to use HS256 verification instead)."
                ) from exc
            if not self._settings.supabase_jwks_url:
                raise ServiceUnavailableError("SUPABASE_JWKS_URL is not configured.")
            # PyJWKClient caches the JWKS document in-process and refetches on
            # an unknown `kid` or once `lifespan` elapses, which matches
            # Supabase's key-rotation behaviour. `lifespan=300` bounds how long
            # a rotated-out key stays usable; `timeout` bounds how long a hung
            # JWKS endpoint can stall a request.
            self._jwks_client = PyJWKClient(
                self._settings.supabase_jwks_url,
                cache_keys=True,
                cache_jwk_set=True,
                lifespan=300,
                timeout=10,
            )
        try:
            return self._jwks_client.get_signing_key_from_jwt(token)
        except Exception as exc:
            if not self._jwks_checked:
                logger.warning(
                    "auth_jwks_fetch_failed",
                    extra={"event": "auth_jwks_fetch_failed", "error_type": type(exc).__name__},
                )
                self._jwks_checked = True
            raise UnauthorizedError("Authentication required.") from exc

    def _to_context(self, claims: dict[str, Any]) -> AuthContext:
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise UnauthorizedError("Authentication required.")

        postgres_role = claims.get("role")
        if postgres_role == "service_role":
            # See module docstring. Logged as a warning because it is either a
            # misconfigured client or someone probing with a leaked key — both
            # worth seeing — but the token itself is never logged.
            logger.warning(
                "auth_service_role_token_rejected",
                extra={
                    "event": "auth_service_role_token_rejected",
                    "detail": "A service_role JWT was presented to the API as a user token.",
                },
            )
            raise ForbiddenError("This credential cannot be used to access the API.")

        app_metadata = claims.get("app_metadata") or {}
        if not isinstance(app_metadata, dict):
            app_metadata = {}
        user_metadata = claims.get("user_metadata") or {}
        if not isinstance(user_metadata, dict):
            user_metadata = {}

        role = str(app_metadata.get("role") or "BUYER").upper()
        if role not in APP_ROLES:
            # An unrecognised role is treated as the least-privileged one rather
            # than rejected: the user is genuinely authenticated, and refusing
            # the request outright would turn a data-entry mistake in
            # app_metadata into a total lockout.
            logger.warning(
                "auth_unknown_role",
                extra={"event": "auth_unknown_role", "role": role, "fallback": "BUYER"},
            )
            role = "BUYER"

        email = claims.get("email")
        if not isinstance(email, str) and isinstance(user_metadata.get("email"), str):
            email = user_metadata["email"]
        phone = claims.get("phone")
        if not isinstance(phone, str):
            phone = user_metadata.get("phone") if isinstance(user_metadata.get("phone"), str) else None

        return AuthContext(
            subject=subject,
            email=email.lower() if isinstance(email, str) else None,
            phone=phone,
            role=role,
            is_onboarded=app_metadata.get("onboarded") is True,
            has_seller_profile=app_metadata.get("has_seller_profile") is True,
            email_confirmed=bool(claims.get("email_confirmed") or claims.get("email_verified")),
            token_id=claims.get("jti") if isinstance(claims.get("jti"), str) else None,
            issued_at=_as_int(claims.get("iat")),
            expires_at=_as_int(claims.get("exp")),
            claims=claims,
        )


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


# ─── Factory & FastAPI wiring ────────────────────────────────────────────────

_verifier: TokenVerifier | None = None


def get_token_verifier(settings: Settings | None = None) -> TokenVerifier:
    """Process-wide verifier, chosen by configuration.

    Returns `UnconfiguredVerifier` (fail-closed) when neither a JWT secret nor
    a usable JWKS setup is present, so a missing env var can never degrade into
    "everyone is anonymous but allowed".
    """
    global _verifier
    if _verifier is None:
        resolved = settings or get_settings()
        candidate = SupabaseJwtVerifier(resolved)
        _verifier = candidate if candidate.is_configured else UnconfiguredVerifier()
        if not candidate.is_configured:
            logger.warning(
                "auth_verifier_unconfigured",
                extra={
                    "event": "auth_verifier_unconfigured",
                    "detail": "Set SUPABASE_JWT_SECRET (HS256) or SUPABASE_JWKS_URL + "
                    "an asymmetric SUPABASE_JWT_ALGORITHMS entry.",
                },
            )
    return _verifier


def reset_token_verifier() -> None:
    """Drop the cached verifier. For tests that change settings between cases."""
    global _verifier
    _verifier = None


def extract_bearer_token(request: Request) -> str | None:
    """Pull the token out of `Authorization: Bearer <jwt>`.

    Case-insensitive scheme match (RFC 7235 says the scheme is case-insensitive,
    and clients get this wrong constantly). Anything else — a cookie, a query
    param, a custom header — is not accepted: query-param tokens end up in
    proxy and access logs, and accepting cookies here would make this API
    subject to CSRF, which `src/lib/csrf.ts` exists to prevent on the frontend.
    """
    header = request.headers.get("authorization")
    if not header:
        return None
    scheme, _, credentials = header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = credentials.strip()
    return token or None


async def get_auth_context(request: Request) -> AuthContext:
    """Dependency: require a valid Supabase token. 401 if absent or invalid.

    @router.get("/me")
    async def me(user: AuthContext = Depends(get_auth_context)): ...
    """
    token = extract_bearer_token(request)
    if token is None:
        logger.info(
            "auth_missing_token",
            extra={
                "event": "auth_missing_token",
                "path": request.url.path,
                "has_authorization_header": "authorization" in request.headers,
            },
        )
        raise UnauthorizedError("Authentication required.")
    return await get_token_verifier().verify(token)


async def get_optional_auth_context(request: Request) -> AuthContext | None:
    """Dependency: identify the caller if they presented a token, else None.

    For endpoints that work either way but personalize when they can. A
    *malformed* token still 401s rather than silently becoming anonymous — a
    client that thinks it is authenticated should be told it isn't, not served
    the logged-out view of its own data.
    """
    token = extract_bearer_token(request)
    if token is None:
        return None
    return await get_token_verifier().verify(token)


def require_role(*roles: str) -> Any:
    """Dependency factory gating an endpoint to specific application roles.

        @router.post("/admin/things")
        async def create(user: AuthContext = Depends(require_role("ADMIN", "SUPER_ADMIN"))): ...

    Role names are uppercased and validated against `APP_ROLES` at *definition*
    time, so a typo in a decorator fails on import instead of silently
    permitting nobody (or, with a looser check, everybody).

    This is a coarse gate, not the authorization boundary. The Next.js
    `middleware.ts` role check is likewise a fast path — anything
    security-sensitive must still re-verify ownership against Postgres in the
    service layer, exactly as the existing Server Actions do.
    """
    normalized: tuple[str, ...] = tuple(role.upper() for role in roles)
    unknown = [role for role in normalized if role not in APP_ROLES]
    if unknown:
        raise ValueError(f"require_role() got unknown application role(s): {unknown}")
    if not normalized:
        raise ValueError("require_role() needs at least one role.")

    allowed: frozenset[str] = frozenset(normalized)

    async def dependency(user: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if user.role not in allowed:
            # Deliberately does not say which role was required: that tells a
            # caller what to aim for.
            logger.warning(
                "auth_role_denied",
                extra={
                    "event": "auth_role_denied",
                    "role": user.role,
                    "required_count": len(allowed),
                },
            )
            raise ForbiddenError("You don't have permission to do that.")
        return user

    return dependency


def seconds_until_expiry(context: AuthContext, *, skew: int = 30) -> int:
    """Seconds until a token expires, floored at 0. For cache TTLs.

    Never cache anything derived from a request longer than the token that
    authorized it, or a cached value outlives the permission to see it.
    """
    if context.expires_at is None:
        return 0
    return max(0, int(context.expires_at - time.time() - skew))


def allowed_roles_for(roles: Iterable[str]) -> tuple[str, ...]:
    """Validate/normalize a role list. Exposed for schema-level validation."""
    normalized = tuple(role.upper() for role in roles)
    unknown = [role for role in normalized if role not in APP_ROLES]
    if unknown:
        raise ValueError(f"Unknown application role(s): {unknown}")
    return normalized
