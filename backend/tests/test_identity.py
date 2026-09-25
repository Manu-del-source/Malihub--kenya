"""Identity resolution: provider id → MaliHub account, read from Postgres.

The rule under test more than any other is that **"not found" and "database
unavailable" are different answers.** Conflating them is not a hypothetical: on
the frontend, an authorization cache that could lag the database produced a
/dashboard ↔ /complete-profile redirect loop that had to be fixed twice. The
backend version of the same mistake would tell a real user their account does
not exist whenever Postgres is slow, and they would re-register.

There is no live Postgres here. A stand-in `Database` supplies one row (or an
error, or nothing), which is enough to pin the resolver's contract: what it
returns, what it raises, and — via the compiled statement — that it looks the
identity up as opaque TEXT rather than casting it to a UUID.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.dialects import postgresql

from app.core.errors import ServiceUnavailableError
from app.core.identity import (
    APP_ROLES,
    ApplicationIdentity,
    DatabaseIdentityResolver,
    get_identity_resolver,
    reset_identity_resolver,
    set_identity_resolver,
)

APP_USER_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")
PROVIDER_ID = "dc42fa70-09a7-4038-a3bb-f61dda854910"


class FakeResult:
    def __init__(self, row: Any) -> None:
        self._row = row

    def one_or_none(self) -> Any:
        return self._row


class FakeSession:
    """Records the statement it was given, then returns a canned row."""

    def __init__(self, row: Any, error: Exception | None, log: list[Any]) -> None:
        self._row = row
        self._error = error
        self._log = log

    async def execute(self, statement: Any) -> FakeResult:
        self._log.append(statement)
        if self._error is not None:
            raise self._error
        return FakeResult(self._row)

    async def commit(self) -> None:  # pragma: no cover - exercised via session()
        return None

    async def rollback(self) -> None:
        return None


class FakeDatabase:
    """Stands in for `core.db.Database`.

    `session_factory is None` is how the real class reports "DATABASE_URL is not
    set", and the resolver must treat that as an outage rather than as a missing
    account — so it has to be modelled faithfully.
    """

    def __init__(
        self, row: Any = None, *, error: Exception | None = None, configured: bool = True
    ) -> None:
        self._row = row
        self._error = error
        self._configured = configured
        self.statements: list[Any] = []
        self.sessions_opened = 0

    @property
    def is_configured(self) -> bool:
        return self._configured

    @property
    def session_factory(self) -> Any:
        return object() if self._configured else None

    @asynccontextmanager
    async def session(self) -> Any:
        self.sessions_opened += 1
        yield FakeSession(self._row, self._error, self.statements)


def a_row(**overrides: Any) -> SimpleNamespace:
    """One joined row: `users` columns plus `profiles.onboarded` and `sellers.id`."""
    values: dict[str, Any] = {
        "id": APP_USER_ID,
        "role": "SELLER",
        "email": "Jane@Example.com",
        "phone": "+254700000000",
        "email_verified": True,
        "is_active": True,
        "is_banned": False,
        "onboarded": True,
        "seller_id": uuid.UUID("99999999-8888-7777-6666-555555555555"),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def resolver_for(**kwargs: Any) -> DatabaseIdentityResolver:
    return DatabaseIdentityResolver(database=FakeDatabase(**kwargs))  # type: ignore[arg-type]


# ─── The mapping itself ──────────────────────────────────────────────────────


async def test_a_mapped_identity_resolves_to_the_application_id() -> None:
    identity = await resolver_for(row=a_row()).resolve(PROVIDER_ID)

    assert identity is not None
    # `users.id` as text — the value every foreign key in the schema expects.
    assert identity.user_id == str(APP_USER_ID)
    assert identity.user_id != PROVIDER_ID
    assert identity.role == "SELLER"
    assert identity.is_onboarded is True
    assert identity.has_seller_profile is True


async def test_the_database_email_is_normalized_and_the_phone_passed_through() -> None:
    identity = await resolver_for(row=a_row()).resolve(PROVIDER_ID)
    assert identity is not None
    assert identity.email == "jane@example.com"  # lowercased for comparison
    assert identity.phone == "+254700000000"  # never normalized: E.164 is the caller's


async def test_a_missing_seller_row_means_no_seller_access() -> None:
    identity = await resolver_for(row=a_row(seller_id=None)).resolve(PROVIDER_ID)
    assert identity is not None
    assert identity.has_seller_profile is False
    # …and the role is unaffected: seller access is "role OR seller row", and
    # this resolver reports the two facts separately rather than merging them.
    assert identity.role == "SELLER"


async def test_a_missing_profile_row_means_not_onboarded() -> None:
    """A LEFT JOIN, so "signed up but never finished onboarding" is a state,
    not an error. An inner join would report it as an unmapped account and send
    the user to /login instead of /complete-profile."""
    identity = await resolver_for(row=a_row(onboarded=None)).resolve(PROVIDER_ID)
    assert identity is not None
    assert identity.is_onboarded is False


async def test_seller_access_does_not_depend_on_the_role() -> None:
    """`requireSellerAccess()` in the Next.js app accepts either, so must this."""
    identity = await resolver_for(
        row=a_row(role="BUYER", seller_id=uuid.uuid4())
    ).resolve(PROVIDER_ID)
    assert identity is not None
    assert identity.role == "BUYER"
    assert identity.has_seller_profile is True


# ─── Not found vs. cannot answer ─────────────────────────────────────────────


async def test_no_mapping_returns_none() -> None:
    identity = await resolver_for(row=None).resolve(PROVIDER_ID)
    assert identity is None


async def test_an_unconfigured_database_is_an_outage_not_a_missing_account() -> None:
    """The distinction the whole module exists to preserve."""
    resolver = DatabaseIdentityResolver(database=FakeDatabase(row=None, configured=False))  # type: ignore[arg-type]
    with pytest.raises(ServiceUnavailableError):
        await resolver.resolve(PROVIDER_ID)


async def test_a_failed_query_is_an_outage_not_a_missing_account() -> None:
    """A connection error must never be reported as `None`.

    `None` means "this person has no MaliHub account", which is what a client
    acts on. An outage that returned `None` would tell every signed-in user
    their account had vanished.
    """
    resolver = resolver_for(row=None, error=RuntimeError("connection refused"))
    with pytest.raises(ServiceUnavailableError):
        await resolver.resolve(PROVIDER_ID)


@pytest.mark.parametrize("auth_user_id", ["", None])
async def test_an_empty_provider_id_never_reaches_the_database(auth_user_id: Any) -> None:
    """No subject, no lookup — and no query built from an empty bind value."""
    database = FakeDatabase(row=a_row())
    resolver = DatabaseIdentityResolver(database=database)  # type: ignore[arg-type]

    assert await resolver.resolve(auth_user_id) is None
    assert database.sessions_opened == 0
    assert database.statements == []


# ─── Role normalization ──────────────────────────────────────────────────────


async def test_a_stored_role_is_uppercased() -> None:
    identity = await resolver_for(row=a_row(role="admin")).resolve(PROVIDER_ID)
    assert identity is not None
    assert identity.role == "ADMIN"
    assert identity.is_staff is True


@pytest.mark.parametrize("stored", ["SUPERUSER", "", None, "seller ", 42])
async def test_an_unrecognized_role_falls_back_to_least_privilege(stored: Any) -> None:
    """A data-entry mistake must never grant access — or lock the user out.

    Falling back to `BUYER` rather than raising means the account still works,
    at the lowest privilege level, and the mistake shows up in a warning instead
    of as a support ticket about a total lockout.
    """
    identity = await resolver_for(row=a_row(role=stored)).resolve(PROVIDER_ID)
    assert identity is not None
    assert identity.role == "BUYER"
    assert identity.is_staff is False


async def test_every_prisma_role_is_accepted() -> None:
    """A role added to the schema and forgotten here would silently become BUYER."""
    for role in sorted(APP_ROLES):
        identity = await resolver_for(row=a_row(role=role)).resolve(PROVIDER_ID)
        assert identity is not None
        assert identity.role == role


def test_the_accepted_roles_match_the_prisma_enum() -> None:
    from app.models.user import UserRoleEnum

    assert set(UserRoleEnum.enums) == set(APP_ROLES)


# ─── Account state ───────────────────────────────────────────────────────────


async def test_a_banned_account_reports_may_act_false() -> None:
    identity = await resolver_for(row=a_row(is_banned=True)).resolve(PROVIDER_ID)
    assert identity is not None
    assert identity.is_banned is True
    assert identity.may_act is False


async def test_a_deactivated_account_reports_may_act_false() -> None:
    identity = await resolver_for(row=a_row(is_active=False)).resolve(PROVIDER_ID)
    assert identity is not None
    assert identity.may_act is False


async def test_an_active_unbanned_account_may_act() -> None:
    identity = await resolver_for(row=a_row()).resolve(PROVIDER_ID)
    assert identity is not None
    assert identity.may_act is True


def test_application_identity_is_immutable() -> None:
    """An authorization object a handler can mutate mid-request is a bug."""
    identity = ApplicationIdentity(
        user_id=str(APP_USER_ID),
        role="BUYER",
        is_onboarded=True,
        has_seller_profile=False,
        email=None,
        phone=None,
        email_verified=True,
        is_active=True,
        is_banned=False,
    )
    with pytest.raises(AttributeError):
        identity.role = "SUPER_ADMIN"  # type: ignore[misc]


# ─── The query it builds ─────────────────────────────────────────────────────


async def test_the_lookup_is_text_equality_with_no_uuid_cast() -> None:
    """`auth_user_id` is TEXT on purpose; the query must not assume otherwise.

    Casting `sub` to a UUID would work against Neon's documented id format and
    break the moment the service issued Better Auth's 32-character form — a
    total authentication outage caused by an assumption nobody verified.
    """
    database = FakeDatabase(row=a_row())
    resolver = DatabaseIdentityResolver(database=database)  # type: ignore[arg-type]
    await resolver.resolve("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")  # not a UUID

    compiled = str(database.statements[0].compile(dialect=postgresql.dialect()))
    # Bound as a plain parameter against the TEXT column. Identifiers come back
    # unquoted from `compile()` unless they need quoting, so the assertion is on
    # the column reference and the absence of any cast — not on quoting style.
    assert "users.auth_user_id =" in compiled
    assert "::uuid" not in compiled
    assert "CAST" not in compiled.upper()


async def test_the_query_left_joins_both_authorization_tables() -> None:
    """`profiles` and `sellers` are LEFT joins, so absence is data, not an error."""
    database = FakeDatabase(row=a_row())
    await DatabaseIdentityResolver(database=database).resolve(PROVIDER_ID)  # type: ignore[arg-type]

    compiled = str(database.statements[0].compile(dialect=postgresql.dialect())).upper()
    assert compiled.count("LEFT OUTER JOIN") == 2
    assert "PROFILES" in compiled
    assert "SELLERS" in compiled


async def test_exactly_one_query_is_issued_per_resolution() -> None:
    """One indexed lookup per authenticated request — the stated cost.

    If this grows, it should grow because a new authorization fact is needed,
    not because of an accidental N+1 across the three tables.
    """
    database = FakeDatabase(row=a_row())
    await DatabaseIdentityResolver(database=database).resolve(PROVIDER_ID)  # type: ignore[arg-type]
    assert len(database.statements) == 1
    assert database.sessions_opened == 1


# ─── Singleton wiring ────────────────────────────────────────────────────────


def test_the_resolver_is_a_process_wide_singleton() -> None:
    reset_identity_resolver()
    first = get_identity_resolver()
    assert get_identity_resolver() is first
    assert isinstance(first, DatabaseIdentityResolver)


def test_a_resolver_can_be_installed_and_cleared() -> None:
    reset_identity_resolver()
    stub = FakeDatabase()
    set_identity_resolver(DatabaseIdentityResolver(database=stub))  # type: ignore[arg-type]
    assert get_identity_resolver() is not None

    reset_identity_resolver()
    # Reset rebuilds from settings rather than keeping the injected one — which
    # is what stops one test's database becoming the next test's.
    assert isinstance(get_identity_resolver(), DatabaseIdentityResolver)
    set_identity_resolver(None)
    assert isinstance(get_identity_resolver(), DatabaseIdentityResolver)
