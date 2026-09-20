"""Supabase token verification — the API's authentication boundary.

The cases here are the ones that decide whether this backend is safe to expose.
Every "rejects" test is more important than every "accepts" test: an
authentication layer that works for valid tokens and quietly passes invalid ones
is worse than one that doesn't exist, because it looks like it's working.
"""

from __future__ import annotations

import time
from typing import Any

import jwt
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.core.errors import ForbiddenError
from app.core.security import (
    AuthContext,
    SupabaseJwtVerifier,
    UnconfiguredVerifier,
    extract_bearer_token,
    get_auth_context,
    get_optional_auth_context,
    get_token_verifier,
    require_role,
)

# 40+ characters each: RFC 7518 requires an HMAC key of at least the hash
# output size (256 bits for HS256), and PyJWT warns below that — which this
# suite turns into an error. Supabase's legacy JWT secrets are 40-character
# random strings, so this matches what the verifier will actually be given.
SECRET = "test-jwt-secret-0123456789abcdef-not-real"
# 64+ characters so it is also a legal HS512 key (the algorithm-confusion
# test signs with HS512).
OTHER_SECRET = "a-completely-different-secret-0123456789-0123456789-0123456789-99"
SUPABASE_URL = "https://xyzcompany.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"


def make_token(
    *,
    secret: str = SECRET,
    algorithm: str = "HS256",
    sub: str = "4f1a2b3c-0000-4000-8000-000000000001",
    role: str = "authenticated",
    app_role: str = "BUYER",
    expires_in: int = 3600,
    not_yet_valid_for: int = 0,
    audience: str = "authenticated",
    issuer: str = ISSUER,
    email: str = "jane@example.com",
    **extra_claims: Any,
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": sub,
        "aud": audience,
        "iss": issuer,
        "role": role,
        "email": email,
        "iat": now,
        "nbf": now + not_yet_valid_for,
        "exp": now + expires_in,
        "jti": "token-id-1",
        "app_metadata": {
            "role": app_role,
            "onboarded": True,
            "has_seller_profile": app_role == "SELLER",
        },
        "user_metadata": {"full_name": "Jane Doe"},
        **extra_claims,
    }
    return jwt.encode(claims, secret, algorithm=algorithm)


@pytest.fixture
def auth_app(make_app: Any) -> Any:
    """An app with authenticated routes, configured for HS256 verification."""
    app = make_app(supabase_url=SUPABASE_URL, supabase_jwt_secret=SECRET)

    @app.get("/test/me")
    async def me(user: AuthContext = Depends(get_auth_context)) -> dict[str, Any]:
        return {
            "subject": user.subject,
            "role": user.role,
            "email": user.email,
            "onboarded": user.is_onboarded,
        }

    @app.get("/test/optional")
    async def optional(user: AuthContext | None = Depends(get_optional_auth_context)) -> dict[str, Any]:
        return {"authenticated": user is not None, "role": user.role if user else None}

    @app.get("/test/seller-only")
    async def seller_only(
        user: AuthContext = Depends(require_role("SELLER", "ADMIN", "SUPER_ADMIN")),
    ) -> dict[str, str]:
        return {"role": user.role}

    return app


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ─── Happy path ──────────────────────────────────────────────────────────────


def test_valid_supabase_token_is_accepted(auth_app: Any) -> None:
    response = TestClient(auth_app).get("/test/me", headers=bearer(make_token(app_role="SELLER")))
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "SELLER"
    assert body["subject"] == "4f1a2b3c-0000-4000-8000-000000000001"
    assert body["onboarded"] is True


def test_app_role_comes_from_app_metadata_not_the_postgres_role() -> None:
    """The trap this module exists to close.

    Supabase's `role` claim is the *Postgres* role (`authenticated`), not
    MaliHub's application role. Reading it as an app role would make every
    logged-in user identical.
    """
    verifier = SupabaseJwtVerifier(_settings_for())
    context = _verify(verifier, make_token(role="authenticated", app_role="SUPER_ADMIN"))
    assert context.role == "SUPER_ADMIN"


def test_missing_app_metadata_role_defaults_to_buyer() -> None:
    token = jwt.encode(
        {
            "sub": "u1",
            "aud": "authenticated",
            "iss": ISSUER,
            "role": "authenticated",
            "exp": int(time.time()) + 600,
            "iat": int(time.time()),
            # no app_metadata at all
        },
        SECRET,
        algorithm="HS256",
    )
    context = _verify(SupabaseJwtVerifier(_settings_for()), token)
    assert context.role == "BUYER"
    assert context.is_onboarded is False


def test_unrecognized_app_role_falls_back_to_least_privilege() -> None:
    """A typo in app_metadata must not lock a user out — or promote them."""
    context = _verify(SupabaseJwtVerifier(_settings_for()), make_token(app_role="SUPERUSER"))
    assert context.role == "BUYER"


def test_optional_auth_returns_anonymous_without_a_token(auth_app: Any) -> None:
    response = TestClient(auth_app).get("/test/optional")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "role": None}


def test_optional_auth_still_rejects_a_malformed_token(auth_app: Any) -> None:
    """A client that thinks it's signed in must be told it isn't.

    Silently downgrading a bad token to anonymous serves the logged-out view of
    the user's own data, which reads as "my orders disappeared".
    """
    response = TestClient(auth_app).get("/test/optional", headers=bearer("not.a.jwt"))
    assert response.status_code == 401


def test_role_gate_allows_a_matching_role(auth_app: Any) -> None:
    response = TestClient(auth_app).get("/test/seller-only", headers=bearer(make_token(app_role="SELLER")))
    assert response.status_code == 200


def test_role_gate_denies_a_non_matching_role(auth_app: Any) -> None:
    response = TestClient(auth_app).get("/test/seller-only", headers=bearer(make_token(app_role="BUYER")))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
    # Must not say which role was required — that tells a caller what to aim for.
    assert "SELLER" not in response.text


def test_require_role_rejects_unknown_roles_at_definition_time() -> None:
    """A typo in a decorator fails on import, not silently in production."""
    with pytest.raises(ValueError, match="unknown application role"):
        require_role("SUPERUSER")
    with pytest.raises(ValueError, match="at least one role"):
        require_role()


# ─── Rejection cases ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("kwargs", "label"),
    [
        ({"secret": OTHER_SECRET}, "wrong signing secret"),
        ({"expires_in": -60}, "expired"),
        ({"not_yet_valid_for": 600}, "not yet valid"),
        ({"audience": "anon"}, "wrong audience"),
        ({"issuer": "https://evil.example/auth/v1"}, "wrong issuer"),
        ({"sub": ""}, "empty subject"),
    ],
)
def test_invalid_tokens_are_rejected(auth_app: Any, kwargs: dict[str, Any], label: str) -> None:
    response = TestClient(auth_app).get("/test/me", headers=bearer(make_token(**kwargs)))
    assert response.status_code == 401, label
    body = response.json()["error"]
    assert body["code"] == "unauthorized"
    # One generic message for every failure mode. Distinguishing "expired" from
    # "bad signature" turns this endpoint into an oracle for iterating on a
    # forgery.
    assert body["message"] == "Authentication required."
    assert label not in response.text


def test_missing_authorization_header_is_401(auth_app: Any) -> None:
    response = TestClient(auth_app).get("/test/me")
    assert response.status_code == 401
    assert response.headers.get("www-authenticate") == "Bearer"


@pytest.mark.parametrize(
    "header",
    [
        "",
        "Bearer",
        "Bearer ",
        "Basic dXNlcjpwYXNz",
        "token abc123",
        "Bearer=",
    ],
)
def test_malformed_authorization_headers_are_not_accepted(auth_app: Any, header: str) -> None:
    response = TestClient(auth_app).get("/test/me", headers={"Authorization": header})
    assert response.status_code == 401


def test_alg_none_is_rejected() -> None:
    """The classic JWT forgery: strip the signature, declare `alg: none`.

    Rejected because the allowed-algorithms list is pinned from configuration
    and never read from the token's own header — and surfaced as our 401 rather
    than PyJWT's `InvalidAlgorithmError`, so a forgery attempt cannot provoke a
    500.
    """
    from app.core.errors import UnauthorizedError

    unsigned = jwt.encode(
        {
            "sub": "u1",
            "aud": "authenticated",
            "iss": ISSUER,
            "exp": int(time.time()) + 600,
            "role": "authenticated",
        },
        key=None,
        algorithm="none",
    )
    with pytest.raises(UnauthorizedError):
        _verify(SupabaseJwtVerifier(_settings_for()), unsigned)


def test_algorithm_confusion_is_rejected() -> None:
    """Re-signing with the public/secret material as an HMAC key must fail.

    The algorithms list is pinned from configuration, so a token claiming a
    different algorithm is refused regardless of what key it was signed with.
    """
    verifier = SupabaseJwtVerifier(_settings_for())
    # HS256-pinned verifier handed a token that claims RS256.
    forged = jwt.encode(
        {
            "sub": "u1",
            "aud": "authenticated",
            "iss": ISSUER,
            "exp": int(time.time()) + 600,
            "role": "authenticated",
        },
        OTHER_SECRET,
        algorithm="HS512",
    )
    from app.core.errors import UnauthorizedError

    with pytest.raises(UnauthorizedError):
        _verify(verifier, forged)


def test_service_role_token_is_refused() -> None:
    """A service_role JWT bypasses RLS; accepting it as a user token is critical.

    If it were accepted — and `role` were (mis)read as the app role — anything
    holding the service key would act as SUPER_ADMIN.
    """
    from app.core.errors import UnauthorizedError

    verifier = SupabaseJwtVerifier(_settings_for())
    # `aud` stays "authenticated" so the token passes claim validation and
    # reaches the service_role check itself — otherwise this test would pass by
    # rejecting the audience and never exercise the branch that matters.
    token = make_token(role="service_role", app_role="SUPER_ADMIN")
    with pytest.raises(ForbiddenError):
        _verify(verifier, token)


def test_unconfigured_verifier_fails_closed(make_app: Any) -> None:
    """No SUPABASE_JWT_SECRET → 503, never "anonymous but allowed"."""
    app = make_app()  # BASE_ENV leaves verification unconfigured

    @app.get("/test/guarded")
    async def guarded(user: AuthContext = Depends(get_auth_context)) -> dict[str, str]:
        return {"subject": user.subject}

    response = TestClient(app).get("/test/guarded", headers=bearer(make_token()))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"
    assert isinstance(get_token_verifier(), UnconfiguredVerifier)


def test_verifier_selection_follows_configuration() -> None:
    """The factory picks fail-closed vs. real verification from configuration.

    `reset_token_verifier()` between the two because the factory is a
    process-wide singleton — which is the behaviour production wants, and the
    reason this has to be explicit in a test.
    """
    from app.core.security import reset_token_verifier

    reset_token_verifier()
    assert isinstance(get_token_verifier(_settings_for(unconfigured=True)), UnconfiguredVerifier)

    reset_token_verifier()
    assert isinstance(get_token_verifier(_settings_for()), SupabaseJwtVerifier)

    reset_token_verifier()


def test_cookies_and_query_tokens_are_not_accepted(auth_app: Any) -> None:
    """Query-param tokens end up in proxy logs; cookies would make this API
    CSRF-able, which `src/lib/csrf.ts` exists to prevent on the frontend."""
    token = make_token()
    client = TestClient(auth_app)
    assert client.get(f"/test/me?access_token={token}").status_code == 401

    cookie_client = TestClient(auth_app)
    cookie_client.cookies.set("sb-access-token", token)
    assert cookie_client.get("/test/me").status_code == 401


def test_extract_bearer_token_is_case_insensitive_on_the_scheme() -> None:
    from starlette.datastructures import Headers
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": Headers({"authorization": "bearer abc.def.ghi"}).raw,
        "query_string": b"",
    }
    assert extract_bearer_token(Request(scope)) == "abc.def.ghi"


def test_auth_context_is_immutable() -> None:
    """An identity object a handler can mutate mid-request is an authz bug."""
    context = AuthContext(subject="u1", role="BUYER")
    with pytest.raises(AttributeError):
        context.role = "SUPER_ADMIN"  # type: ignore[misc]


# ─── helpers ─────────────────────────────────────────────────────────────────


def _settings_for(unconfigured: bool = False) -> Any:
    from tests.conftest import build_settings

    if unconfigured:
        return build_settings()
    return build_settings(supabase_url=SUPABASE_URL, supabase_jwt_secret=SECRET)


def _verify(verifier: SupabaseJwtVerifier, token: str) -> AuthContext:
    import asyncio

    return asyncio.run(verifier.verify(token))
