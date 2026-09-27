"""Resolve a provider identity into MaliHub's application identity.

The half of authentication that a JWT cannot do. Neon Managed Better Auth signs
a token whose `sub` is `neon_auth.user.id` — the *provider's* id. Everything
this backend stores is keyed on `public.users.id`, which MaliHub generates
itself. The bridge is `users.auth_user_id`, and crossing it is a database read.

Two rules shape this module, and both come from bugs that already happened in
this repository:

1. **"Not found" and "database unavailable" are different answers and must never
   be conflated.** A failed lookup means the caller is authenticated but has no
   MaliHub account. A failed *connection* means we do not know. Reporting the
   second as the first tells a real user their account does not exist, and — in
   the Next.js app's version of this mistake — bounced people between
   /dashboard and /complete-profile in a loop. So: no row → `None`; any database
   error or missing configuration → `ServiceUnavailableError` (503). Never
   `None` for an outage.

2. **Authorization is read, never inferred.** Role, onboarding and seller status
   come from Postgres on every request. The retired implementation cached them
   in the provider's `app_metadata` JWT claim so middleware could read them
   without a query; the cache could lag the database, and a stale `onboarded`
   claim was the direct cause of that redirect loop. Neon Auth accepts no custom
   claims, so there is nothing to cache into — the query is the design, not a
   workaround.

Cost, stated plainly: one indexed lookup per authenticated request
(`users.auth_user_id` is unique). That is the price of an answer that cannot go
stale, and it is why `/health` and the public payment-provider list stay
unauthenticated. If it ever needs caching, cache it in Redis for seconds and
invalidate on write — not in a token that outlives the permission it describes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from sqlalchemy import select

from app.core.db import Database, get_database
from app.core.errors import ServiceUnavailableError
from app.core.logging import get_logger
from app.models.user import Profile, Seller, User

logger = get_logger(__name__)

#: Application roles, matching `enum UserRole` in prisma/schema.prisma. Kept in
#: sync with `core.security.APP_ROLES`; both are checked by the test suite.
APP_ROLES = frozenset({"BUYER", "SELLER", "ADMIN", "SUPER_ADMIN"})


@dataclass(frozen=True, slots=True)
class ApplicationIdentity:
    """What Postgres says about the account a provider identity maps to.

    Frozen and slot-backed, like `AuthContext`: an authorization object a
    handler can mutate mid-request is a bug waiting to happen.
    """

    #: `public.users.id` — MaliHub's own id, and the value every foreign key in
    #: this schema expects. **Not** the JWT `sub`.
    user_id: str
    #: `users.role`, normalized to upper case and validated against `APP_ROLES`.
    role: str
    #: `profiles.onboarded`, or False when no profile row exists.
    is_onboarded: bool
    #: Whether a `sellers` row exists. Deliberately *not* derived from `role`:
    #: `requireSellerAccess()` in the Next.js app accepts either, and the two
    #: services must not disagree about who is a seller.
    has_seller_profile: bool
    email: str | None
    phone: str | None
    email_verified: bool
    is_active: bool
    is_banned: bool

    @property
    def is_staff(self) -> bool:
        return self.role in {"ADMIN", "SUPER_ADMIN"}

    @property
    def may_act(self) -> bool:
        """Whether this account is allowed to do anything at all."""
        return self.is_active and not self.is_banned


@runtime_checkable
class IdentityResolver(Protocol):
    """The seam between "this token is valid" and "this is a MaliHub account"."""

    async def resolve(self, auth_user_id: str) -> ApplicationIdentity | None:
        """The account mapped to `auth_user_id`, or `None` if none is.

        Raises `ServiceUnavailableError` when the answer cannot be known. Never
        returns `None` to mean "the database is down".
        """
        ...


class DatabaseIdentityResolver:
    """Read the mapping from Postgres.

    One query, three tables, no ORM relationships: `users` left-joined to
    `profiles` and `sellers` on `user_id`. Left joins because a user who signed
    up but never finished onboarding has no profile row, and "no profile" is a
    legitimate state (`is_onboarded=False`), not a missing-account error.

    `sellers.id` is selected purely to test for existence. No seller column is
    read, which is why the mirror in `models/user.py` stops at `user_id`.
    """

    def __init__(self, database: Database | None = None) -> None:
        self._database = database

    @property
    def _db(self) -> Database:
        return self._database if self._database is not None else get_database()

    @property
    def is_configured(self) -> bool:
        return self._db.is_configured

    async def resolve(self, auth_user_id: str) -> ApplicationIdentity | None:
        if not auth_user_id or not isinstance(auth_user_id, str):
            # An empty subject cannot identify anyone. Callers treat this as an
            # authentication failure, not an outage.
            return None

        database = self._db
        if database.session_factory is None:
            # Not "no such user" — "cannot answer". See rule 1 in the docstring.
            logger.error(
                "identity_resolver_unconfigured",
                extra={
                    "event": "identity_resolver_unconfigured",
                    "detail": "DATABASE_URL is not set; application identity cannot be resolved.",
                },
            )
            raise ServiceUnavailableError(
                "Account lookup is not available on this service. "
                "Set DATABASE_URL on the backend."
            )

        statement = (
            select(
                User.id,
                User.role,
                User.email,
                User.phone,
                User.email_verified,
                User.is_active,
                User.is_banned,
                Profile.onboarded,
                Seller.id.label("seller_id"),
            )
            .select_from(User)
            .outerjoin(Profile, Profile.user_id == User.id)
            .outerjoin(Seller, Seller.user_id == User.id)
            # Equality on TEXT. `auth_user_id` is deliberately not a UUID column
            # — see models/user.py — so no cast is involved and no assumption is
            # made about the provider's id format.
            .where(User.auth_user_id == auth_user_id)
        )

        try:
            async with database.session() as session:
                row = (await session.execute(statement)).one_or_none()
        except ServiceUnavailableError:
            raise
        except Exception as exc:
            # Error *type* only. SQLAlchemy exception text routinely embeds the
            # DSN, the statement, and bound parameter values — and the bound
            # value here is a user's identity.
            logger.warning(
                "identity_lookup_failed",
                extra={"event": "identity_lookup_failed", "error_type": type(exc).__name__},
            )
            raise ServiceUnavailableError(
                "Account lookup failed. Please try again shortly."
            ) from exc

        if row is None:
            # Authenticated, but not a MaliHub account (yet). Logged with the
            # provider id — not an email — because that is the value that
            # explains it, and it is not personally identifying on its own.
            logger.info(
                "identity_unmapped",
                extra={"event": "identity_unmapped", "auth_user_id": auth_user_id},
            )
            return None

        return ApplicationIdentity(
            user_id=str(row.id),
            role=_normalize_role(row.role),
            is_onboarded=bool(row.onboarded),
            has_seller_profile=row.seller_id is not None,
            email=row.email.lower() if isinstance(row.email, str) else None,
            phone=row.phone if isinstance(row.phone, str) else None,
            email_verified=bool(row.email_verified),
            is_active=bool(row.is_active),
            is_banned=bool(row.is_banned),
        )


def _normalize_role(raw: object) -> str:
    """Coerce a stored role to a known application role, least-privilege on doubt.

    An unrecognized value falls back to `BUYER` rather than raising: the account
    is genuinely authenticated, and refusing the request outright would turn a
    data-entry mistake in `users.role` into a total lockout. Falling back to the
    *least* privileged role means the mistake can never grant access.
    """
    role = str(raw or "BUYER").upper()
    if role not in APP_ROLES:
        logger.warning(
            "identity_unknown_role",
            extra={"event": "identity_unknown_role", "role": role, "fallback": "BUYER"},
        )
        return "BUYER"
    return role


_resolver: IdentityResolver | None = None


def get_identity_resolver() -> IdentityResolver:
    """Process-wide resolver. Reset by `reset_identity_resolver()` in tests."""
    global _resolver
    if _resolver is None:
        _resolver = DatabaseIdentityResolver()
    return _resolver


def set_identity_resolver(resolver: IdentityResolver | None) -> None:
    """Install a resolver (or clear it). Used by tests and by app wiring."""
    global _resolver
    _resolver = resolver


def reset_identity_resolver() -> None:
    """Drop the cached resolver, so the next call rebuilds it from settings."""
    global _resolver
    _resolver = None


__all__ = [
    "APP_ROLES",
    "ApplicationIdentity",
    "DatabaseIdentityResolver",
    "IdentityResolver",
    "get_identity_resolver",
    "reset_identity_resolver",
    "set_identity_resolver",
]
