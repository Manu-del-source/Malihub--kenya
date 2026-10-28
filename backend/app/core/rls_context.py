"""Transaction-local PostgreSQL RLS context helpers.

This module only establishes context; it does not enable RLS or define policies.
Call it after the provider identity has been resolved to a MaliHub users.id.
Never use an id supplied by a request body, query parameter, or header.

The third argument to set_config is true, making app.user_id transaction-local.
All protected SQL in the operation must use the same transaction/session.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def set_rls_user_context(session: AsyncSession, user_id: str) -> None:
    """Set app.user_id for the current transaction using a trusted app user id."""
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("A resolved MaliHub user id is required for RLS context")

    await session.execute(
        text("SELECT set_config('app.user_id', :user_id, true)"),
        {"user_id": user_id},
    )


__all__ = ["set_rls_user_context"]
