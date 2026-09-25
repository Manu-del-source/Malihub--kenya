"""Shared FastAPI dependencies.

Everything a route can ask for, in one place, so a route reads as "what it
needs" rather than "how to get it":

    @router.get("/payments/providers")
    async def list_providers(service: PaymentService = Depends(get_payment_service)):
        ...

Re-exported here rather than imported from `core`/`services` directly, so an
endpoint module has exactly one dependency import line and the wiring can be
changed (swapped for a test double, wrapped with caching) without touching
routes.

Authentication note: `get_auth_context` and friends live in `core.security` and
are re-exported below. **Neon Managed Better Auth is the identity provider.**
Nothing here issues, refreshes or stores a credential — these dependencies
verify a token the auth service already signed, resolve it to a MaliHub account
through `users.auth_user_id`, and hand the route an `AuthContext` whose `role`
came from Postgres. There is no second user system and no password anywhere in
this backend.

Use `AuthContext.subject` (MaliHub's `users.id`) for every query. It is **not**
`AuthContext.auth_user_id`, which is the provider's id and matches no foreign
key in this schema.
"""

from __future__ import annotations

from app.core.db import get_database, get_db_session, get_optional_db_session
from app.core.identity import (
    ApplicationIdentity,
    IdentityResolver,
    get_identity_resolver,
)
from app.core.redis import get_redis_gateway
from app.core.security import (
    AuthContext,
    NeonAuthJwtVerifier,
    get_auth_context,
    get_optional_auth_context,
    get_token_verifier,
    require_role,
)
from app.services.email_service import EmailService, get_email_service
from app.services.payment_service import PaymentService, get_payment_service
from app.services.rate_limit import RateLimiter, get_rate_limiter, rate_limit_dependency
from app.services.storage_service import StorageService, get_storage_service

__all__ = [
    "ApplicationIdentity",
    "AuthContext",
    "EmailService",
    "IdentityResolver",
    "NeonAuthJwtVerifier",
    "PaymentService",
    "RateLimiter",
    "StorageService",
    "get_auth_context",
    "get_database",
    "get_db_session",
    "get_email_service",
    "get_identity_resolver",
    "get_optional_auth_context",
    "get_optional_db_session",
    "get_payment_service",
    "get_rate_limiter",
    "get_redis_gateway",
    "get_storage_service",
    "get_token_verifier",
    "rate_limit_dependency",
    "require_role",
]
