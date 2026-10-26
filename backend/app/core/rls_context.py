"""Transaction-local PostgreSQL RLS context helpers.

Call only after authentication has been verified and the provider subject has
been mapped to MaliHub's internal `public.users.id`. Never pass a user id
supplied directly by a request body, query parameter, or header.

The setting is transaction-local (third argument to set_config is true), so it
does not leak to the next request when a pooled connection is reused. The
caller must execute all RLS-protected statements in the same transaction.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def set_rls_user_context(session: AsyncSession, user_id: str) -> None:
    """Set app.user_id for the current transaction using a trusted app user id.

    This does not authenticate the user or create a transaction boundary.
    SQLAlchemy autobegins a transaction when this statement is executed. The
    context remains available only until that transaction commits or rolls back.
    """
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("A resolved MaliHub user id is required for RLS context")

    await session.execute(
        text("SELECT set_config('app.user_id', :user_id, true)"),
        {"user_id": user_id},
    )
