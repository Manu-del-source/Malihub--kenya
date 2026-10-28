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


async def test_authenticated_db_dependency_sets_context_from_internal_subject(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import deps
    from app.core.security import AuthContext

    session = object()
    context_calls: list[tuple[object, str]] = []

    async def fake_get_db_session():
        yield session

    async def fake_set_context(actual_session: object, user_id: str) -> None:
        context_calls.append((actual_session, user_id))

    monkeypatch.setattr(deps, "get_db_session", fake_get_db_session)
    monkeypatch.setattr(deps, "set_rls_user_context", fake_set_context)

    auth = AuthContext(auth_user_id="provider-user", subject="internal-user-123")
    dependency = deps.get_authenticated_db_session(auth)
    assert await anext(dependency) is session
    assert context_calls == [(session, "internal-user-123")]
    await dependency.aclose()


async def test_authenticated_db_dependency_rejects_unmapped_identity() -> None:
    from app.api.deps import get_authenticated_db_session
    from app.core.errors import UnauthorizedError
    from app.core.security import AuthContext

    auth = AuthContext(auth_user_id="provider-user", subject=None)
    dependency = get_authenticated_db_session(auth)

    with pytest.raises(UnauthorizedError):
        await anext(dependency)
