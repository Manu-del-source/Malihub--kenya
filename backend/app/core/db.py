"""PostgreSQL access for the backend.

The application database is independent, standard PostgreSQL. Nothing here
assumes a Supabase-specific extension, role, or API — `DATABASE_URL` can point
at Neon, RDS, Cloud SQL, Supabase, or a laptop, and this module behaves
identically. Supabase is MaliHub's *authentication* provider only; it happens
to also be where Postgres currently runs, which is a deployment fact and not an
architectural dependency.

Two rules that keep this from drifting:

1. **Prisma owns DDL.** `prisma/schema.prisma` is the single source of truth
   for tables, columns, indexes and constraints, and Prisma migrations are what
   change them. This module never calls `Base.metadata.create_all()` — the
   SQLAlchemy classes in `app/models/` are mappings onto tables that already
   exist, and a second migration path would produce two histories that
   disagree.
2. **Sessions are request-scoped.** `get_db_session()` yields one session per
   request and closes it on the way out. A session held across an `await` on
   something slow (an outbound provider call) keeps a pooled connection checked
   out for that whole time; do the database work, then make the call.

Like Redis, the database is optional at import time and checked at use time:
`/api/v1/health` must be able to answer "the process is alive" even when
`DATABASE_URL` is unset or Postgres is unreachable.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings, get_settings
from app.core.errors import ServiceUnavailableError
from app.core.logging import get_logger

logger = get_logger(__name__)


class Database:
    """Lazy engine + session factory with a null-safe configuration story."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._engine: AsyncEngine | None = None
        self._session_factory: async_sessionmaker[AsyncSession] | None = None
        self._unavailable_logged = False

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.database_url)

    @property
    def engine(self) -> AsyncEngine | None:
        if self._engine is not None:
            return self._engine
        # One check that both narrows the type and guards the branch. An
        # `assert` here would work in development and disappear under
        # `python -O` — a flag production images commonly set — leaving
        # `None.get_secret_value()` to raise AttributeError and turn a
        # clean "database not configured" 503 into an unhandled 500.
        database_url = self._settings.database_url
        if database_url is None:
            if not self._unavailable_logged:
                logger.warning(
                    "database_unconfigured",
                    extra={
                        "event": "database_unconfigured",
                        "detail": "DATABASE_URL is not set; database-dependent routes return 503.",
                    },
                )
                self._unavailable_logged = True
            return None

        self._engine = create_async_engine(
            database_url.get_secret_value(),
            echo=self._settings.database_echo,
            pool_size=self._settings.database_pool_size,
            max_overflow=self._settings.database_max_overflow,
            pool_timeout=self._settings.database_pool_timeout_seconds,
            # Recycle well inside the idle-connection timeout every managed
            # Postgres imposes (Neon ~5 min, PgBouncer/RDS similar). Without
            # this, a pooled connection silently killed by the provider
            # surfaces as an opaque "connection already closed" on first use.
            pool_recycle=self._settings.database_pool_recycle_seconds,
            pool_pre_ping=True,
        )
        self._session_factory = async_sessionmaker(
            bind=self._engine,
            expire_on_commit=False,
            class_=AsyncSession,
        )
        logger.info(
            "database_configured",
            extra={
                "event": "database_configured",
                "host": _redact_dsn(self._settings.database_url.get_secret_value()),
                "pool_size": self._settings.database_pool_size,
            },
        )
        return self._engine

    @property
    def session_factory(self) -> async_sessionmaker[AsyncSession] | None:
        if self.engine is None:
            return None
        return self._session_factory

    def require_session_factory(self) -> async_sessionmaker[AsyncSession]:
        factory = self.session_factory
        if factory is None:
            raise ServiceUnavailableError(
                "The database is not available on this backend. Please try again shortly."
            )
        return factory

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """One session, committed on success, rolled back on any exception."""
        factory = self.require_session_factory()
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async def ping(self) -> tuple[bool, float | None]:
        """(reachable, latency_ms). Never raises — see `RedisGateway.ping`."""
        engine = self.engine
        if engine is None:
            return False, None
        started = time.perf_counter()
        try:
            async with engine.connect() as connection:
                await connection.execute(text("select 1"))
        except Exception as exc:
            # Type only: SQLAlchemy exception text frequently embeds the DSN,
            # the failing statement, and bound parameter values.
            logger.warning(
                "database_ping_failed",
                extra={"event": "database_ping_failed", "error_type": type(exc).__name__},
            )
            return False, None
        return True, round((time.perf_counter() - started) * 1000, 2)

    async def dispose(self) -> None:
        if self._engine is not None:
            try:
                await self._engine.dispose()
            except Exception:  # pragma: no cover - shutdown path
                logger.warning(
                    "database_dispose_failed", extra={"event": "database_dispose_failed"}, exc_info=True
                )
            finally:
                self._engine = None
                self._session_factory = None


def _redact_dsn(dsn: str) -> str:
    """Log a DSN's host only. `postgresql+asyncpg://u:p@host/db` → `host`."""
    try:
        without_scheme = dsn.split("://", 1)[1]
        _, _, rest = without_scheme.partition("@")
        host_part, _, _ = rest.partition("/")
        return host_part.split(":")[0]
    except IndexError:
        return "unknown"


_database: Database | None = None


def get_database() -> Database:
    """Process-wide `Database`. One engine, one pool, for the whole app."""
    global _database
    if _database is None:
        _database = Database()
    return _database


def reset_database() -> None:
    """Drop the singleton. For tests that change settings between cases."""
    global _database
    _database = None


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped session.

    Usage:

        @router.get("/things")
        async def list_things(session: AsyncSession = Depends(get_db_session)): ...

    Raises `ServiceUnavailableError` (503, `service_unavailable`) when the
    database isn't configured — which is the honest answer, and better than a
    500 that hides an environment problem as a code bug.
    """
    database = get_database()
    async with database.session() as session:
        yield session


async def get_optional_db_session() -> AsyncIterator[AsyncSession | None]:
    """Same, but yields `None` instead of raising when unconfigured.

    For endpoints that can serve a degraded answer without the database.
    """
    database = get_database()
    if database.session_factory is None:
        yield None
        return
    async with database.session() as session:
        yield session


__all__ = [
    "Database",
    "get_database",
    "get_db_session",
    "get_optional_db_session",
    "reset_database",
]
