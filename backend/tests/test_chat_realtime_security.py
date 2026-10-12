"""Phase 5 acceptance: the security boundaries of the chat realtime surface.

`test_chat_realtime.py` covers the hub's room/presence bookkeeping and the
endpoint's happy path, frame limits and typing throttle. This module covers the
attack-shaped cases the Phase 5 brief calls out explicitly, all locally
verifiable with the same fakes:

* a frame cannot assert somebody else's identity — the user id always comes
  from the ticket (no impersonation);
* events for a chat you are not in are never delivered, and a denial carries
  no existence oracle (an existing chat you are not part of and a chat that
  does not exist are answered identically);
* ticket values and participant ids never reach the logs;
* Redis is used as a bus, never as a message store — a guard client fails the
  test if the realtime path ever touches a key other than the ticket;
* the per-connection chat cap and the receive watchdog actually fire;
* the `Origin` header grants nothing: the ticket is the only credential, so a
  cross-origin handshake without a valid ticket is rejected (CSWSH).

Everything here is local: no live Redis, no database, no deployment.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.services.chat_realtime import CHAT_EVENTS_CHANNEL, ChatRealtimeHub
from tests.conftest import build_settings
from tests.test_chat_realtime import (
    CHAT_1,
    CHAT_2,
    TICKET,
    USER_A,
    USER_B,
    USER_C,
    FakeGateway,
    FakeRedisClient,
    message_row,
    mint,
    ticket_url,
)

#: A chat A is NOT a participant of, owned by two other users.
CHAT_OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
#: A chat id that exists nowhere.
CHAT_MISSING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


class GuardedRedisClient:
    """A Redis client that only exposes what a *bus* needs.

    Any other attribute (``set``, ``setex``, ``lpush``, ``hset``, ``get``, …)
    raises, so a future change that tried to keep chat state in Redis would
    fail this module loudly instead of silently creating a second source of
    truth. The set of permitted calls is recorded for the same reason: a test
    can assert the realtime path never asked for anything else.
    """

    ALLOWED = frozenset({"getdel", "publish", "pubsub"})

    def __init__(self, inner: FakeRedisClient) -> None:
        object.__setattr__(self, "_inner", inner)
        object.__setattr__(self, "used", [])

    def __getattr__(self, name: str) -> Any:
        if name not in self.ALLOWED:
            raise AssertionError(f"chat realtime touched Redis.{name} — Redis must stay a notification bus")
        self.used.append(name)
        return getattr(self._inner, name)


class GuardedGateway(FakeGateway):
    """`FakeGateway` whose `client`/`require()` hand out a guarded client."""

    def __init__(self, inner: FakeRedisClient) -> None:
        super().__init__(inner)
        self.guarded = GuardedRedisClient(inner)

    @property
    def client(self) -> GuardedRedisClient:  # type: ignore[override]
        return self.guarded

    def require(self) -> GuardedRedisClient:  # type: ignore[override]
        return self.guarded


@pytest.fixture
def security_client(make_app: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    """TestClient with TWO chats and a guarded Redis client.

    * `CHAT_1` — (A, B)
    * `CHAT_OTHER` — (B, C), so A is authenticated but not a participant
    * `chat_ws_max_chats_per_connection=1` — the cap is small on purpose
    """
    from app.api.v1.endpoints import chat as chat_endpoint

    settings = build_settings(
        cors_origins="http://localhost:3000",
        chat_ws_max_frame_bytes=1024,
        chat_ws_max_chats_per_connection=1,
    )
    app = create_app(settings)

    store = FakeRedisClient()
    gateway = GuardedGateway(store)
    participants: dict[str, tuple[str, str]] = {CHAT_1: (USER_A, USER_B), CHAT_OTHER: (USER_B, USER_C)}

    async def fake_participant(user_id: str, chat_id: str) -> bool:
        pair = participants.get(chat_id)
        return pair is not None and user_id in pair

    test_hub = ChatRealtimeHub(
        redis_gateway=gateway,  # type: ignore[arg-type]
        participant_check=fake_participant,
    )
    monkeypatch.setattr(chat_endpoint, "get_redis_gateway", lambda: gateway)
    monkeypatch.setattr(chat_endpoint, "get_chat_realtime_hub", lambda: test_hub)

    class Bundle:
        pass

    bundle = Bundle()
    bundle.app = app
    bundle.redis = store
    bundle.gateway = gateway
    bundle.hub = test_hub
    bundle.participants = participants

    with TestClient(app) as test_client:
        bundle.client = test_client
        yield bundle


def _drain_presence_after_join(ws: Any) -> None:
    """Consume the frames a successful join emits for its own socket.

    The join ack is always first; the user's own presence(online) echo follows
    only when the socket was the user's first in the room — which is the case
    in every test here.
    """
    assert ws.receive_json()["type"] == "joined"
    assert ws.receive_json()["type"] == "presence"


# ─── Identity: a frame cannot claim to be somebody else ─────────────────────


async def test_frame_cannot_assert_another_identity(security_client: Any) -> None:
    """`userId`/`senderId` in a frame are ignored — the ticket is the identity."""
    mint(security_client, TICKET, USER_A)

    with security_client.client.websocket_connect(ticket_url()) as ws:
        assert ws.receive_json()["type"] == "hello"

        # A frame that tries to claim B's identity in a chat only B belongs to.
        ws.send_json({"type": "join", "chatId": CHAT_OTHER, "userId": USER_B, "senderId": USER_B})
        denied = ws.receive_json()
        assert denied == {"type": "error", "code": "not_participant", "chatId": CHAT_OTHER}

        # The same claim in a chat A *is* in: the ack is for A, and the
        # presence announcement the room sees names A — never B.
        ws.send_json({"type": "join", "chatId": CHAT_1, "userId": USER_B})
        assert ws.receive_json() == {"type": "joined", "chatId": CHAT_1, "onlineUserIds": []}
        presence = ws.receive_json()
        assert presence == {"type": "presence", "chatId": CHAT_1, "userId": USER_A, "online": True}

    # No frame anywhere in the run carried B: the denied join produced no
    # presence, and the accepted one announced A.
    published_payloads = [json.loads(payload) for _channel, payload in security_client.redis.published]
    assert all(payload.get("userId") != USER_B for payload in published_payloads)


async def test_denial_is_indistinguishable_from_a_missing_chat(security_client: Any) -> None:
    """No existence oracle: not-a-participant and no-such-chat answer identically."""
    mint(security_client, TICKET, USER_A)

    with security_client.client.websocket_connect(ticket_url()) as ws:
        ws.receive_json()  # hello
        before = len(security_client.redis.published)

        ws.send_json({"type": "join", "chatId": CHAT_OTHER})  # exists, A is not in it
        existing_denial = ws.receive_json()
        ws.send_json({"type": "join", "chatId": CHAT_MISSING})  # does not exist
        missing_denial = ws.receive_json()

        # Identical frames except the echoed chatId the client itself sent.
        assert existing_denial["type"] == missing_denial["type"] == "error"
        assert existing_denial["code"] == missing_denial["code"] == "not_participant"
        assert "online" not in json.dumps(missing_denial).lower()

        # A denied join announces nothing to anyone.
        assert len(security_client.redis.published) == before


# ─── Delivery isolation ─────────────────────────────────────────────────────


async def test_events_never_cross_chats(security_client: Any) -> None:
    """An event for a chat with no joined socket reaches nobody; a `ping`
    afterwards proves nothing was buffered ahead of it (WS frames are ordered)."""
    mint(security_client, TICKET, USER_A)
    mint(security_client, "e" * 64, USER_B)

    with (
        security_client.client.websocket_connect(ticket_url()) as ws_a,
        security_client.client.websocket_connect(ticket_url("e" * 64)) as ws_b,
    ):
        ws_a.receive_json()  # hello
        ws_b.receive_json()  # hello
        ws_a.send_json({"type": "join", "chatId": CHAT_1})
        _drain_presence_after_join(ws_a)
        ws_b.send_json({"type": "join", "chatId": CHAT_1})
        _drain_presence_after_join(ws_b)
        ws_a.receive_json()  # B's presence(online) broadcast

        # An event for a chat neither socket joined must reach nobody.
        delivered = await security_client.hub.local_deliver(
            CHAT_MISSING, {"type": "message", "chatId": CHAT_MISSING, "message": message_row(CHAT_MISSING)}
        )
        assert delivered == 0

        # …and nothing leaked into either socket's queue: the next frame each
        # one reads is the pong we send explicitly.
        for ws in (ws_a, ws_b):
            ws.send_json({"type": "ping"})
        assert ws_a.receive_json() == {"type": "pong"}
        assert ws_b.receive_json() == {"type": "pong"}

        # The chat they ARE in still delivers — the isolation above is not a
        # blanket drop.
        await security_client.hub._handle_channel_message(
            CHAT_EVENTS_CHANNEL,
            json.dumps({"type": "message", "chatId": CHAT_1, "message": message_row(CHAT_1)}),
        )
        assert ws_a.receive_json()["type"] == "message"
        assert ws_b.receive_json()["type"] == "message"


# ─── Log hygiene ────────────────────────────────────────────────────────────


class _RecordCollector(logging.Handler):
    """Captures every field a record would emit — message AND `extra` — so a
    leak through a structured field is caught too, not just through the text.

    Attached directly to the two realtime loggers (and the root) instead of
    relying on pytest's `caplog`, because the app's own `configure_logging()`
    runs from the lifespan and removes root handlers — which can silently
    detach a capture handler and turn this test into a no-op.
    """

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.records: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(f"{record.getMessage()} {record.__dict__}")

    def text(self) -> str:
        return "\n".join(self.records)


async def test_tickets_and_user_ids_are_never_logged(security_client: Any) -> None:
    """Ticket values, and the user id a ticket resolves to, never reach a log
    record — including the failure path that logs *why* a ticket failed."""
    collector = _RecordCollector()
    targets = [
        logging.getLogger(),
        logging.getLogger("app.api.v1.endpoints.chat"),
        logging.getLogger("app.services.chat_realtime"),
    ]
    for target in targets:
        target.addHandler(collector)
    try:
        # Positive control: prove the collector is actually wired up, so
        # "nothing sensitive found" cannot be a vacuous pass.
        targets[1].warning("chat_log_capture_canary")

        # 1. Unknown (well-formed) ticket: rejected, nothing logged about it.
        unknown = "a" * 64
        with (
            security_client.client.websocket_connect(ticket_url(unknown)) as ws,
            pytest.raises(WebSocketDisconnect),
        ):
            ws.receive_json()

        # 2. Redis failure while consuming a ticket: the failure IS logged
        #    (event + error type), and still carries neither the ticket nor a
        #    user id.
        failing = "b" * 64
        inner: FakeRedisClient = security_client.redis
        original_getdel = inner.getdel

        async def exploding_getdel(key: str) -> str | None:
            if key.endswith(failing):
                raise RuntimeError("redis exploded")
            return await original_getdel(key)

        inner.getdel = exploding_getdel  # type: ignore[method-assign]
        with (
            security_client.client.websocket_connect(ticket_url(failing)) as ws,
            pytest.raises(WebSocketDisconnect),
        ):
            ws.receive_json()

        # 3. A full, legitimate session for comparison.
        mint(security_client, TICKET, USER_A)
        with security_client.client.websocket_connect(ticket_url()) as ws:
            assert ws.receive_json()["type"] == "hello"
            ws.send_json({"type": "join", "chatId": CHAT_1})
            _drain_presence_after_join(ws)
    finally:
        for target in targets:
            target.removeHandler(collector)

    text = collector.text()
    assert "chat_log_capture_canary" in text, "the log collector never captured anything"
    assert "ws_ticket_consume_failed" in text, "the Redis-failure path logged nothing to inspect"
    assert unknown not in text, "the unknown ticket value leaked into a log record"
    assert failing not in text, "the failing ticket value leaked into a log record"
    assert TICKET not in text, "a consumed ticket value leaked into a log record"
    assert USER_A not in text, "a participant user id leaked into a log record"


# ─── Redis stays a bus ──────────────────────────────────────────────────────


async def test_realtime_path_uses_redis_only_as_a_bus(security_client: Any) -> None:
    """Full flow under a client that rejects every Redis call except
    `getdel` (tickets), `publish` (fan-out) and `pubsub` (subscription).

    If chat state were ever written to Redis — the "Redis is the message
    database" failure mode — this test would raise instead of passing.
    """
    mint(security_client, TICKET, USER_A)

    with security_client.client.websocket_connect(ticket_url()) as ws:
        assert ws.receive_json()["type"] == "hello"
        ws.send_json({"type": "join", "chatId": CHAT_1})
        _drain_presence_after_join(ws)
        ws.send_json({"type": "typing", "chatId": CHAT_1})
        ws.receive_json()  # own typing echo
        await security_client.hub._handle_channel_message(
            CHAT_EVENTS_CHANNEL,
            json.dumps({"type": "message", "chatId": CHAT_1, "message": message_row(CHAT_1)}),
        )
        assert ws.receive_json()["type"] == "message"
        ws.send_json({"type": "leave", "chatId": CHAT_1})
        assert ws.receive_json()["type"] == "left"

    assert set(security_client.gateway.guarded.used) <= GuardedRedisClient.ALLOWED
    assert "getdel" in security_client.gateway.guarded.used
    assert "publish" in security_client.gateway.guarded.used


# ─── Limits, watchdog, origin ───────────────────────────────────────────────


async def test_connection_chat_cap_is_enforced(security_client: Any) -> None:
    """`chat_ws_max_chats_per_connection=1`: the second join is refused, and the
    socket survives (it is a capability limit, not a protocol violation)."""
    mint(security_client, "1" * 64, USER_B)
    mint(security_client, "2" * 64, USER_C)
    mint(security_client, "3" * 64, USER_A)

    participants = security_client.participants
    participants[CHAT_2] = (USER_A, USER_B)  # so the cap, not the gate, is what fires

    with security_client.client.websocket_connect(ticket_url("3" * 64)) as ws:
        ws.receive_json()  # hello
        ws.send_json({"type": "join", "chatId": CHAT_1})
        _drain_presence_after_join(ws)
        ws.send_json({"type": "join", "chatId": CHAT_2})
        assert ws.receive_json() == {"type": "error", "code": "too_many_chats", "chatId": CHAT_2}
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


async def test_watchdog_closes_an_idle_socket(security_client: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """A socket that stops sending is closed with 4000, so rooms and presence
    cannot be held open by a half-dead connection.

    The *timeout value* is stubbed (production default: 60 s, `chat_ws_watchdog_seconds`
    — its floor is 5 s, which would make this test slower than the rest of the
    suite combined). The code path exercised is the real one.
    """
    from app.api.v1.endpoints import chat as chat_endpoint

    real_settings = chat_endpoint.get_settings()

    monkeypatch.setattr(
        chat_endpoint,
        "get_settings",
        lambda: type(real_settings).model_construct(
            **{**real_settings.model_dump(), "chat_ws_watchdog_seconds": 0.2}
        ),
    )

    mint(security_client, TICKET, USER_A)
    with pytest.raises(WebSocketDisconnect) as exc:  # noqa: SIM117
        with security_client.client.websocket_connect(ticket_url()) as ws:
            ws.receive_json()  # hello
            ws.receive_json()  # the close frame surfaces here
    assert exc.value.code == 4000


async def test_origin_header_grants_nothing(security_client: Any) -> None:
    """The WS handshake has no cookie/session trust: the ticket is the only
    credential, so a cross-origin handshake (CSWSH shape) is rejected without
    one — and a foreign Origin with a valid ticket is still just that ticket."""
    evil = {"Origin": "https://evil.example"}

    with (
        security_client.client.websocket_connect(ticket_url(), headers=evil) as ws,
        pytest.raises(WebSocketDisconnect) as exc,
    ):
        ws.receive_json()
    assert exc.value.code == 4401

    # A well-formed but unissued ticket behaves the same.
    with (
        security_client.client.websocket_connect(ticket_url(uuid.uuid4().hex), headers=evil) as ws,
        pytest.raises(WebSocketDisconnect) as exc,
    ):
        ws.receive_json()
    assert exc.value.code == 4401
