"""SQLAlchemy declarative base.

╔══════════════════════════════════════════════════════════════════════════╗
║  Prisma owns the schema. These classes only MAP tables that exist.        ║
╚══════════════════════════════════════════════════════════════════════════╝

`prisma/schema.prisma` is the single source of truth for tables, columns,
indexes, constraints and enums, and Prisma migrations are what change them.
Nothing in this package may call `Base.metadata.create_all()` or emit DDL —
two migration histories against one database is how a schema ends up in a
state neither tool describes.

Practical consequences of that rule, which are easy to get wrong:

* Every `ENUM(...)` is declared with `create_type=False`. Prisma already
  created the Postgres type (named exactly as the Prisma enum, e.g.
  `"PaymentStatus"`); letting SQLAlchemy emit `CREATE TYPE` too fails on the
  second run and, worse, hints that this layer owns the type.
* Column names use the `@map("snake_case")` names from the schema, not the
  camelCase Prisma field names. In the database the column is
  `provider_transaction_id`; that is what gets written here.
* `__table_args__ = {"extend_existing": True}` is unnecessary and unused: no
  table is declared twice, and if one ever is, that is a bug worth an error.

Keeping the mirrored surface small (the payment domain, in
`models/payment.py`) is deliberate. Mirroring the whole schema up front would
create one thing to keep in sync per model, for code that does not exist yet;
each model gets added here when a backend service actually needs it.
`tests/test_models.py` fails if a model is added to `Base.metadata` without
also being covered by the column-name and nullability comparisons.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base for every read/write mapping onto the MaliHub PostgreSQL schema."""


__all__ = ["Base"]
