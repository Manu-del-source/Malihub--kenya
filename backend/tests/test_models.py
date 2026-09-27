"""The SQLAlchemy layer must be a faithful *mirror* of `prisma/schema.prisma`.

Prisma owns the DDL; these classes only describe tables that already exist.
That is a constraint worth testing rather than asserting in a docstring, because
the failure mode is silent and expensive: a mirror that drifts from the schema
compiles fine, imports fine, and then writes the wrong column name — or emits
`CREATE TYPE` against a type Prisma already created.

Most tests here parse `prisma/schema.prisma` and compare. Hand-copied
expectations would drift from the source of truth in exactly the way the mirror
does, which makes them worthless as a guard.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import String, UniqueConstraint, inspect
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.schema import CreateTable

from app.models import Base, Order, Payment, Profile, Seller, User
from app.models.payment import (
    OrderStatusEnum,
    PaymentMethodEnum,
    PaymentProviderEnum,
    PaymentStatusEnum,
)
from app.models.user import UserRoleEnum

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "prisma" / "schema.prisma"
BACKEND_APP = Path(__file__).resolve().parents[1] / "app"

#: Models deliberately mirrored. Everything else in the schema is left alone
#: until a backend service needs it — see `app/models/base.py`.
#:
#: The identity tables joined when Neon Auth replaced Supabase: the backend must
#: cross from the provider's id (JWT `sub`) to `users.id`, and read the
#: authoritative role/onboarding/seller state that used to ride in the token's
#: `app_metadata` claim. `profiles` and `sellers` are mapped for one column and
#: for existence respectively — no more than the authorization rule needs.
MIRRORED = {
    "orders": Order,
    "payments": Payment,
    "profiles": Profile,
    "sellers": Seller,
    "users": User,
}

#: Table name → the Prisma *model* name. Deriving one from the other
#: (`"payments".rstrip("s")`) is the kind of cleverness that breaks on the
#: first irregular name — `users`→`User` happens to work, `profiles`→`Profile`
#: does not survive a name like `addresses`.
PRISMA_MODEL = {
    "orders": "Order",
    "payments": "Payment",
    "profiles": "Profile",
    "sellers": "Seller",
    "users": "User",
}


# ─── A small Prisma parser ───────────────────────────────────────────────────


def _prisma_text() -> str:
    assert SCHEMA_PATH.is_file(), f"prisma schema not found at {SCHEMA_PATH}"
    return SCHEMA_PATH.read_text(encoding="utf-8")


def _blocks(kind: str) -> dict[str, str]:
    """`{name: body}` for every top-level `kind Name { ... }` block."""
    pattern = re.compile(rf"^{kind}\s+(\w+)\s*\{{(?P<body>.*?)^\}}", re.MULTILINE | re.DOTALL)
    return {m.group(1): m.group("body") for m in pattern.finditer(_prisma_text())}


_FIELD_LINE = re.compile(
    r"^\s*(?P<name>\w+)\s+(?P<type>\w+)(?P<list>\[\])?(?P<optional>\?)?\s*(?P<attrs>.*)$"
)


def _prisma_fields(model: str) -> dict[str, dict[str, Any]]:
    """Scalar fields of a Prisma model, keyed by *database column name*.

    Relations and list fields are skipped: they are not columns. The column
    name is `@map("x")` when present and the field name otherwise, which is
    Prisma's own rule.
    """
    models = _blocks("model")
    assert model in models, f"{model} is not in the prisma schema"
    model_names = set(models)

    fields: dict[str, dict[str, Any]] = {}
    for line in models[model].splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("//", "///", "@@")):
            continue
        match = _FIELD_LINE.match(line)
        if not match:
            continue
        prisma_type = match.group("type")
        if match.group("list") or "@relation" in match.group("attrs"):
            continue
        if prisma_type in model_names:  # a relation named without @relation
            continue

        attrs = match.group("attrs")
        mapped = re.search(r'@map\("([^"]+)"\)', attrs)
        fields[mapped.group(1) if mapped else match.group("name")] = {
            "field": match.group("name"),
            "type": prisma_type,
            "optional": bool(match.group("optional")),
            "attrs": attrs,
        }
    return fields


def _prisma_enum(name: str) -> list[str]:
    body = _blocks("enum").get(name)
    assert body is not None, f"enum {name} is not in the prisma schema"
    return [line.strip() for line in body.splitlines() if line.strip() and not line.strip().startswith("//")]


def _prisma_table_name(model: str) -> str:
    match = re.search(r'@@map\("([^"]+)"\)', _blocks("model")[model])
    return match.group(1) if match else model


def _prisma_indexes(model: str) -> list[list[str]]:
    """Column lists from `@@index([...])`, in declaration order."""
    body = _blocks("model")[model]
    return [[c.strip() for c in m.split(",")] for m in re.findall(r"@@index\(\[([^\]]+)\]", body)]


def _snake(name: str) -> str:
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name).lower()


def _columns(model: type) -> dict[str, Any]:
    """Columns keyed by *database* name.

    `inspect(Model)` returns a Mapper, whose `.columns` is keyed by Python
    attribute name and which has no `indexes`/`unique_constraints`/
    `foreign_keys` at all. The tests below care about what the database sees,
    so they go through `Model.__table__` consistently.
    """
    return {column.name: column for column in model.__table__.columns}


# ─── Enum values mirror the schema exactly ───────────────────────────────────


@pytest.mark.parametrize(
    ("sqlalchemy_enum", "prisma_name"),
    [
        (PaymentProviderEnum, "PaymentProvider"),
        (PaymentMethodEnum, "PaymentMethod"),
        (PaymentStatusEnum, "PaymentStatus"),
        (OrderStatusEnum, "OrderStatus"),
        (UserRoleEnum, "UserRole"),
    ],
)
def test_enum_values_match_prisma_exactly(sqlalchemy_enum: PG_ENUM, prisma_name: str) -> None:
    """Same values, same order.

    Order is not cosmetic: `ALTER TYPE … ADD VALUE` appends, so the database's
    ordinal order depends on migration history, and comparing orders here
    catches a mirror that was edited independently of a migration.
    """
    assert sqlalchemy_enum.name == prisma_name
    assert list(sqlalchemy_enum.enums) == _prisma_enum(prisma_name)


@pytest.mark.parametrize(
    "sqlalchemy_enum",
    [PaymentProviderEnum, PaymentMethodEnum, PaymentStatusEnum, OrderStatusEnum],
)
def test_enums_do_not_ask_sqlalchemy_to_create_the_type(sqlalchemy_enum: PG_ENUM) -> None:
    """`create_type=False` everywhere.

    Prisma created these Postgres types. Emitting `CREATE TYPE` from this layer
    fails on the second run and, worse, implies SQLAlchemy owns DDL it does not.
    """
    assert sqlalchemy_enum.create_type is False


def test_payment_methods_include_bank_transfer_added_in_phase8() -> None:
    """`BANK_TRANSFER` is the value the Phase 8 migration appends."""
    assert "BANK_TRANSFER" in PaymentMethodEnum.enums
    assert "MPESA" not in PaymentMethodEnum.enums  # renamed to the neutral MOBILE_MONEY


# ─── Tables, columns, nullability ────────────────────────────────────────────


@pytest.mark.parametrize(("table_name", "model"), sorted(MIRRORED.items()))
def test_table_names_match_prisma_map(table_name: str, model: type) -> None:
    assert model.__tablename__ == table_name
    assert _prisma_table_name(PRISMA_MODEL[table_name]) == table_name


@pytest.mark.parametrize(("table_name", "model"), sorted(MIRRORED.items()))
def test_every_mirrored_column_exists_in_prisma_with_the_same_name(table_name: str, model: type) -> None:
    """No invented columns, no stale ones.

    The mirror may be a *subset* of the table (`orders` deliberately omits
    delivery fields it does not use), but every column it declares must exist
    in the schema under that exact name — a typo here writes to a column that
    does not exist, or silently shadows a different one.
    """
    prisma_columns = set(_prisma_fields(PRISMA_MODEL[table_name]))
    mapped_columns = set(_columns(model))

    assert mapped_columns <= prisma_columns, f"not in the prisma schema: {mapped_columns - prisma_columns}"


@pytest.mark.parametrize(("table_name", "model"), sorted(MIRRORED.items()))
def test_nullability_matches_prisma(table_name: str, model: type) -> None:
    """A `String?` in Prisma is `nullable=True` here.

    Getting this backwards is the kind of error that survives every unit test
    and fails on the first real write.
    """
    fields = _prisma_fields(PRISMA_MODEL[table_name])
    for name, column in _columns(model).items():
        if name not in fields:
            continue
        assert column.nullable is fields[name]["optional"], (
            f"{table_name}.{name}: prisma says "
            f"{'nullable' if fields[column.name]['optional'] else 'required'}, "
            f"the mirror says {'nullable' if column.nullable else 'required'}"
        )


def test_the_payment_mirror_covers_every_scalar_prisma_column() -> None:
    """`payments` is fully mirrored — it is the table this backend writes.

    `orders` is a partial mirror on purpose, so the subset rule above is what
    applies there; for payments a missing column means a missing feature.
    """
    prisma_columns = set(_prisma_fields("Payment"))
    assert prisma_columns == set(_columns(Payment))


def test_provider_metadata_maps_to_the_metadata_column() -> None:
    """`metadata` is reserved by SQLAlchemy's declarative base.

    The Python attribute is `provider_metadata`; the *column* must stay
    `metadata`, because that is what the database has. A mirror that renamed
    the column to match the attribute would fail on every read.
    """
    assert "metadata" in _columns(Payment)
    assert Payment.provider_metadata.property.columns[0].name == "metadata"
    assert _prisma_fields("Payment")["metadata"]["field"] == "metadata"


@pytest.mark.parametrize(
    ("column", "prisma_field"),
    [
        ("provider_transaction_id", "providerTransactionId"),
        ("provider_reference", "providerReference"),
        ("customer_reference", "customerReference"),
        ("payer_reference", "payerReference"),
        ("raw_callback_payload", "rawCallbackPayload"),
        ("failure_code", "failureCode"),
        ("failure_reason", "failureReason"),
        ("retry_count", "retryCount"),
    ],
)
def test_camel_case_prisma_fields_are_mapped_to_snake_case_columns(column: str, prisma_field: str) -> None:
    assert column in _columns(Payment)
    assert _prisma_fields("Payment")[column]["field"] == prisma_field
    assert _snake(prisma_field) == column


def test_no_daraja_or_mpesa_specific_columns_survive_the_migration() -> None:
    """The Phase 8 migration renamed every provider-specific column.

    These names are what a Daraja-only schema looked like; if any of them is
    still declared here, the mirror is describing a table that no longer exists.
    """
    gone = {
        "mpesa_checkout_request_id",
        "mpesa_receipt_number",
        "mpesa_phone_number",
        "mpesa_merchant_request_id",
        "result_code",
        "result_desc",
        "checkout_request_id",
        "receipt_number",
    }
    assert not (set(_columns(Payment)) & gone)


def test_money_is_integer_minor_units() -> None:
    """Integer cents, never a float and never a provider-formatted string.

    A float amount is a rounding bug waiting to be reconciled against a
    provider's ledger; this is the money convention in ARCHITECTURE.md §6.
    """
    from sqlalchemy import Integer

    for model, name in (
        (Payment, "amount_cents"),
        (Order, "total_cents"),
        (Order, "subtotal_cents"),
        (Payment, "retry_count"),
    ):
        assert isinstance(_columns(model)[name].type, Integer), f"{model.__name__}.{name}"


def test_currency_defaults_to_kes() -> None:
    assert "'KES'" in str(_columns(Payment)["currency"].server_default.arg)


# ─── Keys, indexes, constraints ──────────────────────────────────────────────


@pytest.mark.parametrize("model", [Payment, Order])
def test_primary_keys_are_server_side_generated_uuids(model: type) -> None:
    """`gen_random_uuid()` on the server, matching Prisma's `@dbgenerated`.

    Server-side matters: two writers generating ids independently is how a
    duplicate surfaces only under concurrency. `gen_random_uuid()` is core
    Postgres 13+, so it needs no extension on any managed provider.
    """
    pk = model.__table__.primary_key  # a PrimaryKeyConstraint, not a list
    assert [column.name for column in pk.columns] == ["id"]
    assert "gen_random_uuid()" in str(next(iter(pk.columns)).server_default.arg)


def test_index_names_are_the_ones_prisma_generates() -> None:
    """Names must match Prisma's, or `prisma migrate diff` reports drift.

    Drift reported against a database Prisma also manages is how a schema ends
    up with two histories fighting over the same table.
    """
    actual = {index.name: [column.name for column in index.columns] for index in Payment.__table__.indexes}

    # Derived from the schema's own `@@index([...])` declarations, using
    # Prisma's naming rule: <table>_<snake(columns)>_idx.
    expected = {
        f"payments_{'_'.join(_snake(c) for c in cols)}_idx": [_snake(c) for c in cols]
        for cols in _prisma_indexes("Payment")
    }

    assert actual == expected


def test_unique_constraints_carry_prisma_generated_names() -> None:
    uniques = {
        constraint.name: [column.name for column in constraint.columns]
        for constraint in Payment.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert uniques == {
        "payments_provider_transaction_id_key": ["provider_transaction_id"],
        "payments_provider_reference_key": ["provider_reference"],
    }
    # Both are `@unique` in the schema — the idempotency keys a retried
    # provider callback is matched against.
    prisma_fields = _prisma_fields("Payment")
    for column in ("provider_transaction_id", "provider_reference"):
        assert "@unique" in prisma_fields[column]["attrs"]


def test_uniqueness_is_declared_exactly_once_per_column() -> None:
    """An inline `unique=True` *and* a named `UniqueConstraint` describe the same
    thing twice.

    The columns in `Payment` are `@unique` in Prisma, which generates one
    constraint with a predictable name. Declaring it inline too yields a second,
    unnamed constraint — invisible while nothing emits DDL, and two indexes on
    one column the moment something does.
    """
    for model in (Payment, Order):
        unique_columns: dict[str, int] = {}
        for name, column in _columns(model).items():
            if column.unique:
                unique_columns[name] = unique_columns.get(name, 0) + 1
        for constraint in model.__table__.constraints:
            if isinstance(constraint, UniqueConstraint):
                assert constraint.name, f"{model.__name__}: an unnamed unique constraint"
                for column in constraint.columns:
                    unique_columns[column.name] = unique_columns.get(column.name, 0) + 1
        doubled = {name: count for name, count in unique_columns.items() if count > 1}
        assert not doubled, f"{model.__name__} declares uniqueness twice for {doubled}"


def test_order_number_is_unique_under_its_prisma_name() -> None:
    """It doubles as `Payment.customer_reference`, so it is the reconciliation
    join key — it must stay unique."""
    names = {c.name for c in Order.__table__.constraints if isinstance(c, UniqueConstraint)}
    assert names == {"orders_order_number_key"}
    assert "@unique" in _prisma_fields("Order")["order_number"]["attrs"]


def test_payment_belongs_to_an_order_with_cascade_delete() -> None:
    """Prisma declares `onDelete: Cascade`; the mirror must agree.

    If they disagreed, SQLAlchemy would issue a DELETE the database refuses, or
    leave orphaned payments behind — depending which side was wrong.
    """
    fk = next(iter(_columns(Payment)["order_id"].foreign_keys))
    assert fk.target_fullname == "orders.id"
    assert fk.ondelete == "CASCADE"
    assert "onDelete: Cascade" in _blocks("model")["Payment"]


# ─── Timestamps ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("model", [Payment, Order])
def test_updated_at_is_refreshed_on_write(model: type) -> None:
    """Prisma's `@updatedAt` is applied by the Prisma client, not the database.

    A write that goes through SQLAlchemy instead therefore needs its own
    `onupdate`, or `updated_at` freezes at creation time for every payment the
    backend touches.
    """
    assert _columns(model)["updated_at"].onupdate is not None
    assert "@updatedAt" in _prisma_fields(PRISMA_MODEL[model.__tablename__])["updated_at"]["attrs"]


@pytest.mark.parametrize("model", [Payment, Order])
def test_timestamps_are_timezone_aware(model: type) -> None:
    """Naive datetimes against a `timestamptz` column are a silent bug.

    Kenya is UTC+3 with no DST, so an EAT wall-clock time stored as naive reads
    back as UTC and every "paid in the last hour" query is three hours wrong.
    """
    columns = _columns(model)
    for name in ("created_at", "updated_at"):
        assert columns[name].type.timezone is True, f"{model.__name__}.{name}"
    assert _columns(Payment)["paid_at"].type.timezone is True


# ─── Behaviour on the model ──────────────────────────────────────────────────


@pytest.mark.parametrize("status", ["SUCCESS", "FAILED", "CANCELLED", "REFUNDED"])
def test_terminal_statuses_are_recognized(status: str) -> None:
    payment = Payment(status=status)
    assert payment.is_terminal is True


@pytest.mark.parametrize("status", ["PENDING", "PROCESSING"])
def test_non_terminal_statuses_are_not(status: str) -> None:
    assert Payment(status=status).is_terminal is False


def test_terminal_statuses_are_a_subset_of_the_prisma_enum() -> None:
    """A status added to the schema and forgotten here would look non-terminal
    forever — a webhook could re-settle an already-settled payment."""
    from app.models.payment import _TERMINAL_STATUSES

    assert set(PaymentStatusEnum.enums) >= _TERMINAL_STATUSES


def test_is_settled_means_success_only() -> None:
    assert Payment(status="SUCCESS").is_settled is True
    assert Payment(status="REFUNDED").is_settled is False


# ─── The rule that Prisma owns the DDL ───────────────────────────────────────


def test_nothing_in_the_backend_emits_ddl() -> None:
    """`create_all` / `drop_all` must not appear anywhere in `app/`.

    Two migration histories against one database is how a schema ends up in a
    state neither tool describes. This is a textual guard on purpose: it fails
    on the *intent*, before anyone has run it against a real database.
    """
    offenders = []
    for path in BACKEND_APP.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        relative = path.relative_to(BACKEND_APP)
        # `models/base.py` documents the rule by naming the forbidden calls in
        # prose. A docstring is not executable SQL, so it is excluded — but only
        # docstrings, not ordinary comments or string literals.
        docstrings = set()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            body = getattr(node, "body", None) or []
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                docstrings.add(id(body[0].value))

        # An actual call — `Base.metadata.create_all(engine)`. Prose mentions
        # in docstrings are fine and are in fact how the rule is documented.
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr in {"create_all", "drop_all", "create_drop_all"}:
                offenders.append(f"{relative}:{node.lineno} references .{node.attr}")
            # A SQL string literal that would create schema.
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
                upper = node.value.upper()
                if any(needle in upper for needle in ("CREATE TABLE", "CREATE TYPE", "ALTER TABLE")):
                    offenders.append(f"{relative}:{node.lineno} SQL literal {node.value[:40]!r}")

    assert not offenders, "\n".join(offenders)


def test_the_mirrored_surface_is_deliberately_small() -> None:
    """Only the payment and identity domains are mirrored, per `models/base.py`.

    Mirroring all 25 Prisma models up front creates 25 things to keep in sync
    for code that does not exist yet. If this test fails because a model was
    added, that is fine — update `MIRRORED` and make sure the column-name and
    nullability tests above cover it. That is what happened for the identity
    tables: the backend needed to resolve a provider id to `users.id`, so
    `users`/`profiles`/`sellers` were added and are covered above.
    """
    assert set(Base.metadata.tables) == set(MIRRORED)
    assert len(_blocks("model")) > len(MIRRORED)  # the schema is much bigger


# ─── The identity mirror ─────────────────────────────────────────────────────
#
# These tests pin the properties that make the provider→application id mapping
# safe. Each guards an assumption that would otherwise fail silently: a UUID
# column that rejects a valid provider id, a primary key that claims a default
# the schema does not have, or a constraint name that makes `prisma migrate
# diff` report drift against a database Prisma also manages.


def test_users_id_has_no_server_default_because_malihub_generates_it() -> None:
    """`users.id` is `String @id @db.Uuid` with no `@default`.

    Unlike `payments.id` and `profiles.id`, which Prisma does generate
    server-side. Declaring `gen_random_uuid()` here would claim a default the
    schema does not have — and is why `User` is deliberately absent from the
    server-side-PK parametrization above.
    """
    pk = User.__table__.primary_key
    assert [column.name for column in pk.columns] == ["id"]
    assert next(iter(pk.columns)).server_default is None
    assert "@default" not in _prisma_fields("User")["id"]["attrs"]


def test_auth_user_id_is_text_not_uuid() -> None:
    """TEXT accepts both candidate provider id formats; UUID accepts one.

    Neon's docs show `neon_auth.user.id` as `uuid default_random()`, while
    Better Auth's own default generator produces 32-character strings. Which one
    MaliHub sees was never settled against the live service, so mapping this as
    UUID would be a guess that surfaces as a total authentication outage rather
    than as an error anyone could trace.
    """
    column = _columns(User)["auth_user_id"]
    assert isinstance(column.type, String)
    assert not isinstance(column.type, UUID)
    assert column.nullable is True  # legacy rows keep NULL until backfilled
    assert _prisma_fields("User")["auth_user_id"]["optional"] is True


def test_identity_unique_constraints_carry_prisma_generated_names() -> None:
    """`<table>_<column>_key`, or `prisma migrate diff` reports drift."""
    users = {
        constraint.name: [column.name for column in constraint.columns]
        for constraint in User.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert users == {
        "users_auth_user_id_key": ["auth_user_id"],
        "users_email_key": ["email"],
        "users_phone_key": ["phone"],
    }
    for column in ("auth_user_id", "email", "phone"):
        assert "@unique" in _prisma_fields("User")[column]["attrs"]

    assert {
        constraint.name
        for constraint in Profile.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    } == {"profiles_user_id_key"}
    assert {
        constraint.name
        for constraint in Seller.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    } == {"sellers_user_id_key"}


def test_uniqueness_is_declared_exactly_once_for_auth_user_id() -> None:
    """An inline `unique=True` plus a named constraint describes it twice."""
    assert _columns(User)["auth_user_id"].unique is not True
    named = [
        constraint.name
        for constraint in User.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
        and [column.name for column in constraint.columns] == ["auth_user_id"]
    ]
    assert named == ["users_auth_user_id_key"]


def test_the_identity_mirror_reads_the_role_as_the_prisma_enum_type() -> None:
    """`role` must resolve to the quoted `"UserRole"` type, not a VARCHAR."""
    ddl = str(CreateTable(User.__table__).compile(dialect=postgresql.dialect()))
    assert '"UserRole"' in ddl


def test_compiled_ddl_uses_postgres_enum_types_not_varchar() -> None:
    """A compiled `CREATE TABLE` for reference only — it is never executed.

    The point of compiling is to prove the enum columns resolve to the quoted
    Prisma type names, which is what a hand-written migration would have to
    match.
    """
    ddl = str(CreateTable(Payment.__table__).compile(dialect=postgresql.dialect()))
    for quoted in ('"PaymentProvider"', '"PaymentMethod"', '"PaymentStatus"'):
        assert quoted in ddl
    assert "metadata JSONB" in ddl
    assert "CREATE TYPE" not in ddl
