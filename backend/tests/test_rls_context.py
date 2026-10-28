from __future__ import annotations

from typing import Any

import pytest

from app.core.rls_context import set_rls_user_context


class FakeSession:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, dict[str, str]]] = []

    async def execute(self, statement: Any, params: dict[str, str]) -> None:
        self.calls.append((statement, params))


@pytest.mark.parametrize("user_id", ["", " ", None])
async def test_rls_context_rejects_missing_user_id(user_id: Any) -> None:
    session = FakeSession()

    with pytest.raises(ValueError):
        await set_rls_user_context(session, user_id)  # type: ignore[arg-type]

    assert session.calls == []


async def test_rls_context_uses_parameterized_transaction_local_setting() -> None:
    session = FakeSession()
    user_id = "11111111-2222-3333-4444-555555555555"

    await set_rls_user_context(session, user_id)

    assert len(session.calls) == 1
    statement, params = session.calls[0]
    assert "set_config('app.user_id', :user_id, true)" in str(statement)
    assert params == {"user_id": user_id}
