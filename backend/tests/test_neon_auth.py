"""Neon Managed Better Auth — the API's authentication boundary.

These are the tests that decide whether the migration is real or cosmetic. The
rejection cases matter more than the acceptance cases, and three of them exist
because the failure they guard against is *silent*:

* `test_subject_is_the_application_id_and_never_the_provider_id` — a backend
  that used the JWT `sub` as `users.id` would verify every token successfully
  and then find no data, or another user's data. Nothing raises.
* `test_role_comes_from_postgres_not_from_the_token` — the `app_metadata` claim
  this migration removed. If it ever creeps back, authorization is being read
  from a cache again, and the /dashboard ↔ /complete-profile loop it caused is
  one stale write away.
* `test_issuer_is_the_origin_not_the_base_url` — Neon's `iss` is the service
  origin with the path dropped, while its JWKS lives under the full base URL.
  The two differ by exactly the part that is easy to get wrong, and the earlier
  draft of `docs/auth/MIGRATION.md` §7 got it wrong.

Signing is done with a real RSA key and verified through a stand-in JWKS client,
so the cryptographic path is genuinely exercised: `alg: none` and
algorithm-confusion forgeries are attempted against a verifier pinned from
configuration, not against a mock that agrees with the test.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from app.core.config import ConfigurationError
from app.core.errors import ForbiddenError, ServiceUnavailableError, UnauthorizedError
from app.core.identity import ApplicationIdentity, set_identity_resolver
from app.core.security import (
    AuthContext,
    NeonAuthJwtVerifier,
    SupabaseJwtVerifier,
    UnconfiguredVerifier,
    get_auth_context,
    get_token_verifier,
)

# ─── Fixtures: a real key pair, and the URLs Neon Auth actually uses ──────────

_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTHER_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)

_PRIVATE_PEM = _PRIVATE_KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
_OTHER_PRIVATE_PEM = _OTHER_PRIVATE_KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
_PUBLIC_PEM = _PRIVATE_KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
)
_JWK = RSAAlgorithm.from_jwk(RSAAlgorithm.to_jwk(_PRIVATE_KEY.public_key()))

#: The base URL includes a path; the issuer does not. Both are derived from
#: `NEON_AUTH_BASE_URL`, and mixing them up is the failure mode under test.
BASE_URL = "https://ep-test.neonauth.c-2.us-east-1.aws.neon.tech/neondb/auth"
ORIGIN = "https://ep-test.neonauth.c-2.us-east-1.aws.neon.tech"
JWKS_URL = f"{BASE_URL}/.well-known/jwks.json"

#: A provider id (`neon_auth.user.id`) and a MaliHub id (`users.id`). They are
#: different values, which is the entire point of the mapping column.
PROVIDER_ID = "dc42fa70-09a7-4038-a3bb-f61dda854910"
APP_USER_ID = "11111111-2222-3333-4444-555555555555"


class FakeJWKSClient:
    """Stand-in for `PyJWKClient`: serves the public key, or fails.

    Only the two behaviours the verifier depends on are modelled — return a
    signing key for a known `kid`, or raise. Raising is what a key-fetch outage
    looks like from the verifier's side, and how it responds to that is a test
    in its own right (`test_a_jwks_outage_is_503_not_401`).
    """

    def __init__(self, *, fail: bool = False) -> None:
        self._fail = fail
        self.calls = 0

    def get_signing_key_from_jwt(self, token: str) -> Any:
        self.calls += 1
        if self._fail:
            raise RuntimeError("simulated JWKS endpoint outage")
        header = jwt.get_unverified_header(token)
        if header.get("kid") != "test-key":
            raise RuntimeError(f"unknown kid: {header.get('kid')}")
        return _JWK


class FakeResolver:
    """Stand-in for `DatabaseIdentityResolver`."""

    def __init__(self, identity: ApplicationIdentity | None = None, *, error: Exception | None = None) -> None:
        self._identity = identity
        self._error = error
        self.requested: list[str] = []

    async def resolve(self, auth_user_id: str) -> ApplicationIdentity | None:
        self.requested.append(auth_user_id)
        if self._error is not None:
            raise self._error
        return self._identity


def make_identity(**overrides: Any) -> ApplicationIdentity:
    values: dict[str, Any] = {
        "user_id": APP_USER_ID,
        "role": "SELLER",
        "is_onboarded": True,
        "has_seller_profile": True,
        "email": "jane@example.com",
        "phone": "+254700000000",
        "email_verified": True,
        "is_active": True,
        "is_banned": False,
    }
    values.update(overrides)
    return ApplicationIdentity(**values)


def make_token(
    *,
    key: bytes = _PRIVATE_PEM,
    algorithm: str = "RS256",
    sub: str = PROVIDER_ID,
    issuer: str = ORIGIN,
    audience: str | None = ORIGIN,
    role: str = "authenticated",
    expires_in: int = 3600,
    not_yet_valid_for: int = 0,
    kid: str | None = "test-key",
    email: str | None = "token@example.com",
    headers: dict[str, Any] | None = None,
    **extra: Any,
) -> str:
    """A token shaped like the one Neon Auth issues.

    The claim set mirrors a decoded production token: `sub`, `id`, `role`,
    `iss`, `aud`, `iat`, `exp`, plus `createdAt`/`updatedAt`. There is no
    `app_metadata` — which is why authorization cannot come from the token.
    """
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": sub,
        "id": sub,
        "role": role,
        "iss": issuer,
        "iat": now,
        "nbf": now + not_yet_valid_for,
        "exp": now + expires_in,
        "jti": "neon-token-1",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
        **extra,
    }
    if audience is not None:
        claims["aud"] = audience
    if email is not None:
        claims["email"] = email

    token_headers = {"kid": kid} if kid else {}
    if headers:
        token_headers.update(headers)
    return jwt.encode(claims, key, algorithm=algorithm, headers=token_headers or None)


def neon_settings(**overrides: Any) -> Any:
    from tests.conftest import build_settings

    # Merged, not passed twice: a test may legitimately override the base URL
    # (to assert an unconfigured or non-https value) and `build_settings` takes
    # one value per field.
    values: dict[str, Any] = {"neon_auth_base_url": BASE_URL, **overrides}
    return build_settings(**values)


def make_verifier(
    resolver: FakeResolver | None = None, *, jwks: FakeJWKSClient | None = None, **overrides: Any
) -> NeonAuthJwtVerifier:
    return NeonAuthJwtVerifier(
        neon_settings(**overrides),
        resolver=resolver if resolver is not None else FakeResolver(make_identity()),
        jwks_client=jwks if jwks is not None else FakeJWKSClient(),
    )


# ─── The migration's central invariant ───────────────────────────────────────


async def test_subject_is_the_application_id_and_never_the_provider_id() -> None:
    """The two ids are different values and must not be interchangeable.

    A backend that set `subject = sub` would pass every other test in this file
    and then query `orders WHERE buyer_id = <provider id>` — matching nothing,
    or matching whoever happens to own that UUID. Silent, and catastrophic.
    """
    resolver = FakeResolver(make_identity())
    context = await make_verifier(resolver).verify(make_token())

    assert context.auth_user_id == PROVIDER_ID
    assert context.subject == APP_USER_ID
    assert context.subject != context.auth_user_id
    # The lookup key is the provider id, never the application id.
    assert resolver.requested == [PROVIDER_ID]


async def test_the_provider_id_is_used_for_the_lookup_and_the_app_id_for_queries() -> None:
    """`is_mapped` distinguishes "resolved" from "authenticated but unknown"."""
    context = await make_verifier(FakeResolver(make_identity())).verify(make_token())
    assert context.is_mapped is True
    assert context.is_authenticated is True


async def test_role_comes_from_postgres_not_from_the_token() -> None:
    """The trap this migration exists to close.

    The token claims a role, and even carries a full `app_metadata` block. Both
    are ignored: the database said BUYER, so the caller is a BUYER.
    """
    resolver = FakeResolver(make_identity(role="BUYER", has_seller_profile=False))
    token = make_token(
        role="SUPER_ADMIN",
        app_metadata={"role": "SUPER_ADMIN", "onboarded": True, "has_seller_profile": True},
    )
    context = await make_verifier(resolver).verify(token)

    assert context.role == "BUYER"
    assert context.is_staff is False
    assert context.has_seller_profile is False


async def test_onboarding_and_seller_state_come_from_the_database() -> None:
    resolver = FakeResolver(make_identity(role="BUYER", is_onboarded=False, has_seller_profile=False))
    context = await make_verifier(resolver).verify(make_token())

    assert context.is_onboarded is False
    assert context.has_seller_profile is False
    # A seller row grants seller access independently of `role`, matching
    # `requireSellerAccess()` in the Next.js app.
    resolver = FakeResolver(make_identity(role="BUYER", is_onboarded=True, has_seller_profile=True))
    context = await make_verifier(resolver).verify(make_token())
    assert context.role == "BUYER"
    assert context.has_seller_profile is True


async def test_the_database_email_wins_over_the_token_email() -> None:
    """The token's email is a fallback, never an override."""
    resolver = FakeResolver(make_identity(email="authoritative@example.com"))
    context = await make_verifier(resolver).verify(make_token(email="stale@example.com"))
    assert context.email == "authoritative@example.com"


async def test_token_claims_survive_on_the_context() -> None:
    context = await make_verifier().verify(make_token())
    assert context.claims["sub"] == PROVIDER_ID
    assert context.token_id == "neon-token-1"
    assert context.expires_at is not None and context.issued_at is not None


# ─── Issuer derivation: the easiest thing to get wrong ───────────────────────


async def test_issuer_is_the_origin_not_the_base_url() -> None:
    """`iss` drops the path; the JWKS URL keeps it.

    Pinned as a test because the two strings differ only by the part that is
    easy to transpose, and getting it wrong rejects every valid token.
    """
    settings = neon_settings()
    assert settings.neon_auth_jwks_url == JWKS_URL  # path kept
    assert settings.neon_auth_jwt_issuer == ORIGIN  # path dropped
    assert settings.neon_auth_jwt_issuer != settings.neon_auth_base_url

    verifier = make_verifier()
    # Correct issuer: accepted.
    await verifier.verify(make_token(issuer=ORIGIN))
    # The base URL as issuer: rejected, even though it looks plausible.
    with pytest.raises(UnauthorizedError):
        await verifier.verify(make_token(issuer=BASE_URL))


async def test_a_foreign_issuer_is_rejected() -> None:
    with pytest.raises(UnauthorizedError):
        await make_verifier().verify(make_token(issuer="https://evil.example/neondb/auth"))


async def test_audience_is_not_enforced_by_default() -> None:
    """Observed tokens carry `aud`, but it is not guaranteed present.

    Enforcing it would reject every token from an issuer that omits the claim —
    a total outage traded for defence-in-depth that signature+`iss` already
    largely provide.
    """
    assert neon_settings().neon_auth_jwt_audience is None
    verifier = make_verifier()
    await verifier.verify(make_token(audience="something-else-entirely"))
    await verifier.verify(make_token(audience=None))


async def test_audience_is_enforced_when_explicitly_configured() -> None:
    verifier = make_verifier(neon_auth_jwt_audience=ORIGIN)
    await verifier.verify(make_token(audience=ORIGIN))
    with pytest.raises(UnauthorizedError):
        await verifier.verify(make_token(audience="not-the-audience"))


# ─── Cryptographic rejections ────────────────────────────────────────────────


async def test_a_token_signed_by_a_different_key_is_rejected() -> None:
    with pytest.raises(UnauthorizedError):
        await make_verifier().verify(make_token(key=_OTHER_PRIVATE_PEM))


async def test_an_expired_token_is_rejected() -> None:
    with pytest.raises(UnauthorizedError):
        await make_verifier().verify(make_token(expires_in=-60))


async def test_a_not_yet_valid_token_is_rejected() -> None:
    with pytest.raises(UnauthorizedError):
        await make_verifier().verify(make_token(not_yet_valid_for=600))


async def test_alg_none_is_rejected() -> None:
    """An unsigned token must never verify, whatever the claims say."""
    unsigned = jwt.encode(
        {"sub": PROVIDER_ID, "iss": ORIGIN, "exp": int(time.time()) + 600},
        key=None,
        algorithm="none",
    )
    with pytest.raises(UnauthorizedError):
        await make_verifier().verify(unsigned)


def _forge_hs256_using_the_public_key_as_the_secret(claims: dict[str, Any]) -> str:
    """Hand-build the classic algorithm-confusion forgery.

    `jwt.encode(..., _PUBLIC_PEM, algorithm="HS256")` cannot be used: PyJWT
    refuses to treat a PEM public key as an HMAC secret, which is a good guard
    but useless here — an attacker does not use PyJWT's guard. So the token is
    assembled from primitives, exactly as an attacker would, and the verifier
    under test has to be the thing that rejects it.
    """
    import base64
    import hashlib
    import hmac
    import json

    def segment(payload: bytes) -> str:
        return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")

    header = segment(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = segment(json.dumps(claims, separators=(",", ":")).encode())
    signing_input = f"{header}.{body}".encode("ascii")
    signature = hmac.new(_PUBLIC_PEM, signing_input, hashlib.sha256).digest()
    return f"{header}.{body}.{segment(signature)}"


async def test_algorithm_confusion_is_rejected() -> None:
    """Re-signing with the *public* key as an HMAC secret must not verify.

    The attack works against verifiers that take the algorithm from the token
    header: the public key is not secret, so anyone can produce an HMAC
    signature a naive verifier will accept. Two independent layers stop it here
    — `Settings` refuses to configure an HMAC algorithm at all, and the verifier
    rejects an unpinned algorithm from the unverified header before it ever
    fetches a key.
    """
    forged = _forge_hs256_using_the_public_key_as_the_secret(
        {"sub": PROVIDER_ID, "iss": ORIGIN, "exp": int(time.time()) + 600}
    )
    with pytest.raises(UnauthorizedError):
        await make_verifier().verify(forged)


@pytest.mark.parametrize("sub", ["", None])
async def test_a_token_without_a_usable_subject_is_rejected(sub: Any) -> None:
    token = make_token(sub=sub if isinstance(sub, str) else PROVIDER_ID)
    if sub is None:
        # Drop the claim entirely rather than sending `null`.
        claims = jwt.decode(token, options={"verify_signature": False})
        claims.pop("sub")
        token = jwt.encode(claims, _PRIVATE_PEM, algorithm="RS256", headers={"kid": "test-key"})
    with pytest.raises(UnauthorizedError):
        await make_verifier().verify(token)


async def test_an_unknown_kid_is_not_a_valid_token() -> None:
    with pytest.raises((UnauthorizedError, ServiceUnavailableError)):
        await make_verifier().verify(make_token(kid="rotated-out-key"))


async def test_every_rejection_shares_one_generic_message() -> None:
    """Distinguishing "expired" from "bad signature" makes this an oracle."""
    for token in (
        make_token(key=_OTHER_PRIVATE_PEM),
        make_token(expires_in=-60),
        make_token(issuer="https://evil.example"),
    ):
        with pytest.raises(UnauthorizedError) as excinfo:
            await make_verifier().verify(token)
        assert str(excinfo.value) == "Authentication required."


# ─── Account state: what the database read makes possible ────────────────────


async def test_an_unmapped_identity_is_forbidden_not_unauthorized() -> None:
    """Valid token, no `users.auth_user_id` match.

    403, not 401: we know exactly who they are, they just have no MaliHub
    account yet. Telling them to re-authenticate would loop.
    """
    with pytest.raises(ForbiddenError):
        await make_verifier(FakeResolver(None)).verify(make_token())


async def test_a_banned_account_is_refused_immediately() -> None:
    """What the stateless Supabase-era verifier could not do.

    A ban now takes effect on the next request instead of at token expiry.
    """
    with pytest.raises(ForbiddenError):
        await make_verifier(FakeResolver(make_identity(is_banned=True))).verify(make_token())


async def test_a_deactivated_account_is_refused() -> None:
    with pytest.raises(ForbiddenError):
        await make_verifier(FakeResolver(make_identity(is_active=False))).verify(make_token())


async def test_a_database_outage_is_never_reported_as_an_unmapped_account() -> None:
    """The bug class this migration removed on the frontend, checked here too.

    "Cannot answer" must not become "you have no account", which would tell a
    real user their account does not exist during an outage.
    """
    resolver = FakeResolver(error=ServiceUnavailableError("database down"))
    with pytest.raises(ServiceUnavailableError):
        await make_verifier(resolver).verify(make_token())


async def test_a_jwks_outage_is_503_not_401() -> None:
    """An unreachable JWKS endpoint must not read as an invalid token.

    Answering 401 here makes every signed-in client discard a valid credential
    and re-authenticate — which fails again while the outage lasts. Both fail
    closed; only one causes a login loop.
    """
    with pytest.raises(ServiceUnavailableError):
        await make_verifier(jwks=FakeJWKSClient(fail=True)).verify(make_token())


# ─── Configuration and provider selection ────────────────────────────────────


def test_an_hmac_algorithm_is_refused_at_configuration_time() -> None:
    """Not ignored at request time — refused at boot, with a readable reason."""
    from tests.conftest import build_settings

    with pytest.raises(ConfigurationError, match="asymmetric"):
        build_settings(neon_auth_base_url=BASE_URL, neon_auth_jwt_algorithms="HS256")


def test_neon_verification_requires_a_jwks_url() -> None:
    from tests.conftest import build_settings

    assert build_settings().neon_jwt_verification_mode == "unconfigured"
    assert build_settings(neon_auth_base_url=BASE_URL).neon_jwt_verification_mode == "jwks"
    assert build_settings(neon_auth_base_url=BASE_URL).active_auth_mode == "neon-jwks"


def test_a_configured_supabase_secret_does_not_rescue_a_neon_deployment() -> None:
    """No cross-provider fallback, in either direction.

    Accepting Supabase tokens after the cutover would leave a stale trust root
    alive for as long as an old token stayed unexpired — the exact window a
    leaked credential needs.
    """
    from tests.conftest import build_settings

    settings = build_settings(supabase_jwt_secret="not-a-real-secret-0123456789abcdef0123456789")
    assert settings.jwt_verification_mode == "hs256"  # Supabase *is* usable…
    assert settings.active_auth_mode == "unconfigured"  # …but is not selected
    assert isinstance(get_token_verifier(settings), UnconfiguredVerifier)


def test_the_legacy_provider_is_still_selectable_for_rollback() -> None:
    from tests.conftest import build_settings

    settings = build_settings(
        auth_provider="supabase-legacy",
        supabase_url="https://xyz.supabase.co",
        supabase_jwt_secret="not-a-real-secret-0123456789abcdef0123456789",
    )
    assert settings.active_auth_mode == "supabase-hs256"
    verifier = get_token_verifier(settings)
    assert isinstance(verifier, SupabaseJwtVerifier)
    assert not isinstance(verifier, NeonAuthJwtVerifier)


def test_neon_is_the_default_provider() -> None:
    from tests.conftest import build_settings

    assert build_settings().auth_provider == "neon"


def test_the_factory_selects_the_neon_verifier_by_default() -> None:
    settings = neon_settings()
    verifier = get_token_verifier(settings)
    assert isinstance(verifier, NeonAuthJwtVerifier)
    assert verifier.is_configured is True


def test_an_unconfigured_neon_backend_names_the_right_variable() -> None:
    """A generic "not configured" sends a deployer down the Supabase path."""
    from tests.conftest import build_settings

    settings = build_settings()
    verifier = get_token_verifier(settings)
    assert isinstance(verifier, UnconfiguredVerifier)
    assert "NEON_AUTH_BASE_URL" in settings.describe_missing_auth_configuration()


async def test_the_unconfigured_verifier_fails_closed_with_the_provider_hint() -> None:
    verifier = UnconfiguredVerifier(neon_settings(neon_auth_base_url=None))
    with pytest.raises(ServiceUnavailableError, match="NEON_AUTH_BASE_URL"):
        await verifier.verify("anything")


def test_a_non_https_base_url_warns() -> None:
    settings = neon_settings(neon_auth_base_url="http://insecure.example/neondb/auth")
    warnings = settings.validate_for_environment()
    assert any("https" in warning for warning in warnings)


# ─── End to end, through FastAPI ─────────────────────────────────────────────


@pytest.fixture
def neon_app(make_app: Any) -> Any:
    """An app whose auth dependency resolves through an injected identity."""
    set_identity_resolver(FakeResolver(make_identity(role="ADMIN", is_onboarded=True)))
    app = make_app(neon_auth_base_url=BASE_URL)

    @app.get("/test/me")
    async def me(user: AuthContext = Depends(get_auth_context)) -> dict[str, Any]:
        return {
            "subject": user.subject,
            "auth_user_id": user.auth_user_id,
            "role": user.role,
            "onboarded": user.is_onboarded,
            "mapped": user.is_mapped,
        }

    return app


def test_a_request_carries_the_application_id_end_to_end(neon_app: Any, monkeypatch: Any) -> None:
    """The wire-level proof: what a route handler actually receives."""
    verifier = get_token_verifier()
    assert isinstance(verifier, NeonAuthJwtVerifier)
    # Inject the test JWKS client into the verifier the factory already built.
    monkeypatch.setattr(verifier, "_jwks_client", FakeJWKSClient())

    response = TestClient(neon_app).get(
        "/test/me", headers={"Authorization": f"Bearer {make_token()}"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["subject"] == APP_USER_ID
    assert body["auth_user_id"] == PROVIDER_ID
    assert body["role"] == "ADMIN"
    assert body["onboarded"] is True
    assert body["mapped"] is True


def test_an_unmapped_caller_gets_403_end_to_end(neon_app: Any, monkeypatch: Any) -> None:
    set_identity_resolver(FakeResolver(None))
    verifier = get_token_verifier()
    monkeypatch.setattr(verifier, "_jwks_client", FakeJWKSClient())

    response = TestClient(neon_app).get(
        "/test/me", headers={"Authorization": f"Bearer {make_token()}"}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_a_missing_token_is_still_401(neon_app: Any) -> None:
    response = TestClient(neon_app).get("/test/me")
    assert response.status_code == 401
    assert response.headers.get("www-authenticate") == "Bearer"


@pytest.mark.parametrize(
    "provider_id",
    [
        # Neon's own docs show `neon_auth.user.id` as `uuid default_random()`…
        "dc42fa70-09a7-4038-a3bb-f61dda854910",
        # …while Better Auth's default id generator produces 32-character
        # strings. Which one MaliHub sees was never settled against the live
        # service, so `auth_user_id` is TEXT and neither shape may be parsed.
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    ],
)
async def test_the_provider_id_is_never_parsed_or_cast(provider_id: str) -> None:
    """Both id formats must survive verification byte-for-byte.

    A verifier that cast `sub` to a UUID would work in testing and reject every
    token the moment the service issued the other format — a total
    authentication outage caused by an assumption nobody checked.
    """
    resolver = FakeResolver(make_identity())
    context = await make_verifier(resolver).verify(make_token(sub=provider_id))

    assert context.auth_user_id == provider_id
    assert resolver.requested == [provider_id]  # looked up verbatim
    assert context.subject == APP_USER_ID  # and mapped to MaliHub's own id


async def test_a_non_uuid_provider_id_is_not_rejected_as_malformed() -> None:
    """Regression guard: `sub` is opaque text, not a UUID to be validated."""
    resolver = FakeResolver(make_identity())
    context = await make_verifier(resolver).verify(make_token(sub=str(uuid.uuid4()).replace("-", "")))
    assert context.auth_user_id and "-" not in context.auth_user_id
