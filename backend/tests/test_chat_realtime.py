"""Chat realtime: the hub (rooms, presence, fan-out) and the WebSocket endpoint.

Everything runs against in-memory stand-ins:

* `FakeRedisClient` — `getdel` for one-shot tickets, `publish` capture, and a
  queue-based pubsub so the hub's pump can be driven deterministically.
* `FakeGateway` — the gateway surface the hub/endpoint touch (`client`,
  `require()`, `key()`), mirroring the real key format `malihub:api:…`.
* `FakeWebSocket` — records frames instead of speaking the wire.

The endpoint tests go through the real `TestClient` WebSocket transport, so
accept/close codes, frame dispatch and presence cleanup are exercised end to
end; only the hub's participant check (database) is faked, with a plain dict
standing in for the `chats` table.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.chat_realtime import (
    CHAT_CONTROL_CHANNEL,
    CHAT_EVENTS_CHANNEL,
    ChatRealtimeHub,
    get_chat_realtime_hub,
)
from tests.conftest import build_settings

USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
USER_C = "33333333-3333-4333-8333-333333333333"
CHAT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CHAT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
TICKET = "f" * 64
OTHER_TICKET = "e" * 64


class FakeRedisClient:
    """The slice of `redis.asyncio.Redis` the hub and endpoint use."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.published: list[tuple[str, str]] = []
        self._queue: list[dict[str, str]] = []

    async def getdel(self, key: str) -> str | None:
        return self.store.pop(key, None)

    async def publish(self, channel: str, payload: str) -> int:
        self.published.append((channel, payload))
        # Deliver to our own subscriptions too — exactly what a real pubsub
        # does to subscribers on the same connection family. This is what
        # makes the echo-skip logic in the pump meaningful in tests.
        self._queue.append({"type": "message", "channel": channel, "data": payload})
        return len(self._queue)

    def pubsub(self) -> FakePubSub:
        return FakePubSub(self)

    def enqueue(self, channel: str, payload: dict[str, Any]) -> None:
        """Simulate a publish arriving from ANOTHER instance."""
        self._queue.append({"type": "message", "channel": channel, "data": json.dumps(payload)})


class FakePubSub:
    def __init__(self, client: FakeRedisClient) -> None:
        self._client = client
        self._closed = False

    async def subscribe(self, *channels: str) -> None:
        self._channels = channels

    async def listen(self) -> Any:
        # One-shot: yields whatever is queued, then stops. Tests that need
        # the long-running pump drive `_handle_channel_message` directly.
        while self._client._queue:
            yield self._client._queue.pop(0)

    async def aclose(self) -> None:
        self._closed = True


class FakeGateway:
    def __init__(self, client: FakeRedisClient | None) -> None:
        self._client = client
        self.is_configured = client is not None

    @property
    def client(self) -> FakeRedisClient | None:
        return self._client

    def require(self) -> FakeRedisClient:
        if self._client is None:
            raise RuntimeError("redis not configured")
        return self._client

    def key(self, *parts: str) -> str:
        # Mirrors RedisGateway.key (settings.redis_key with the `api` namespace).
        return ":".join(["malihub", "api", *parts])


class FakeWebSocket:
    """Hashable, records frames. `fail_send` makes one send raise to prove a
    dead socket cannot break delivery to the others."""

    _ids: int = 0

    def __init__(self, name: str | None = None, fail_send: bool = False) -> None:
        FakeWebSocket._ids += 1
        self.id = name or f"ws-{FakeWebSocket._ids}"
        self.sent: list[str] = []
        self.fail_send = fail_send

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"<FakeWebSocket {self.id}>"

    async def send_text(self, data: str) -> None:
        if self.fail_send:
            raise RuntimeError("socket broken")
        self.sent.append(data)

    async def send_json(self, data: dict[str, Any]) -> None:
        if self.fail_send:
            raise RuntimeError("socket broken")
        self.sent.append(json.dumps(data))

    def frames(self) -> list[dict[str, Any]]:
        return [json.loads(frame) for frame in self.sent]


def make_hub(
    client: FakeRedisClient | None = None,
    participants: dict[str, tuple[str, str]] | None = None,
) -> ChatRealtimeHub:
    """Hub wired to fakes. `participants` maps chat_id -> (buyer, seller)."""
    participants = participants or {}

    async def check(user_id: str, chat_id: str) -> bool:
        pair = participants.get(chat_id)
        return pair is not None and user_id in pair

    return ChatRealtimeHub(
        redis_gateway=FakeGateway(client),  # type: ignore[arg-type]
        participant_check=check,
    )


def message_row(chat_id: str, message_id: str = "m-1") -> dict[str, Any]:
    return {
        "id": message_id,
        "chatId": chat_id,
        "senderId": USER_A,
        "content": "hello",
        "imageUrl": None,
        "readAt": None,
        "editedAt": None,
        "deletedAt": None,
        "createdAt": "2026-10-12T10:00:00.000Z",
    }


# ─── Hub: rooms and per-user presence ───────────────────────────────────────


async def test_join_is_idempotent_and_tracks_members() -> None:
    hub = make_hub(participants={CHAT_1: (USER_A, USER_B)})
    ws = FakeWebSocket()
    hub.register(ws, USER_A)

    first, second = hub.join(ws, CHAT_1), hub.join(ws, CHAT_1)
    assert first == (False, True)  # not a member yet; user became online
    assert second == (True, False)  # idempotent; already online

    assert hub.joined_chats(ws) == [CHAT_1]
    assert hub.online_others(CHAT_1, USER_A) == []


async def test_multi_tab_presence_only_flips_on_last_socket() -> None:
    hub = make_hub(participants={CHAT_1: (USER_A, USER_B)})
    tab1, tab2 = FakeWebSocket("tab1"), FakeWebSocket("tab2")
    hub.register(tab1, USER_A)
    hub.register(tab2, USER_A)
    hub.join(tab1, CHAT_1)

    # Second tab joins: user is already online → no second announcement flag.
    _was_member, became_online = hub.join(tab2, CHAT_1)
    assert became_online is False

    # Closing one tab: user is still online via the other.
    transitions = hub.unregister(tab1)
    assert transitions == [(CHAT_1, False)]
    assert hub.online_others(CHAT_1, USER_A) == []

    # Closing the last tab: offline transition, room torn down.
    transitions = hub.unregister(tab2)
    assert transitions == [(CHAT_1, True)]
    assert hub.joined_chats(tab2) == []


async def test_leave_reports_membership_and_offline_transition() -> None:
    hub = make_hub(participants={CHAT_1: (USER_A, USER_B)})
    ws = FakeWebSocket()
    hub.register(ws, USER_A)
    hub.join(ws, CHAT_1)

    was_member, went_offline = hub.leave(ws, CHAT_1)
    assert (was_member, went_offline) == (True, True)
    # Idempotent second leave.
    assert hub.leave(ws, CHAT_1) == (False, False)
    # Leaving an unjoined chat.
    assert hub.leave(ws, CHAT_2) == (False, False)


async def test_online_others_lists_distinct_participants() -> None:
    hub = make_hub(participants={CHAT_1: (USER_A, USER_B)})
    ws_a, ws_b = FakeWebSocket("a"), FakeWebSocket("b")
    hub.register(ws_a, USER_A)
    hub.register(ws_b, USER_B)
    hub.join(ws_a, CHAT_1)
    hub.join(ws_b, CHAT_1)

    assert hub.online_others(CHAT_1, USER_A) == [USER_B]
    assert hub.online_others(CHAT_1, USER_B) == [USER_A]
    # A non-member (or a third party) sees the same snapshot.
    assert hub.online_others(CHAT_1, USER_C) == [USER_A, USER_B]


# ─── Hub: delivery and Redis fan-out ────────────────────────────────────────


async def test_local_deliver_reaches_only_joined_sockets() -> None:
    hub = make_hub()
    ws_in, ws_out = FakeWebSocket("in"), FakeWebSocket("out")
    hub.register(ws_in, USER_A)
    hub.register(ws_out, USER_C)
    hub.join(ws_in, CHAT_1)

    delivered = await hub.local_deliver(CHAT_1, {"type": "message", "chatId": CHAT_1, "message": message_row(CHAT_1)})
    assert delivered == 1
    assert len(ws_in.frames()) == 1
    assert ws_out.frames() == []


async def test_local_deliver_isolated_from_dead_sockets() -> None:
    hub = make_hub()
    alive, dead = FakeWebSocket("alive"), FakeWebSocket("dead", fail_send=True)
    hub.register(alive, USER_A)
    hub.register(dead, USER_B)
    hub.join(alive, CHAT_1)
    hub.join(dead, CHAT_1)

    delivered = await hub.local_deliver(CHAT_1, {"type": "message", "chatId": CHAT_1, "message": message_row(CHAT_1)})
    assert delivered == 2  # attempted both
    assert len(alive.frames()) == 1  # the healthy socket still got it
    assert dead.frames() == []


async def test_broadcast_control_publishes_for_other_instances() -> None:
    client = FakeRedisClient()
    hub = make_hub(client=client)
    ws = FakeWebSocket()
    hub.register(ws, USER_A)
    hub.join(ws, CHAT_1)

    await hub.broadcast_control(CHAT_1, {"type": "typing", "userId": USER_A})

    assert len(ws.frames()) == 1
    frame = ws.frames()[0]
    assert frame["type"] == "typing"
    assert frame["chatId"] == CHAT_1
    # `instance` is internal plumbing (echo-skip) and must not reach clients.
    assert "instance" not in frame

    assert len(client.published) == 1
    channel, payload = client.published[0]
    assert channel == CHAT_CONTROL_CHANNEL
    published = json.loads(payload)
    assert published["instance"] == hub.instance_id  # other instances need it


async def test_pump_relays_foreign_control_events_and_skips_echoes() -> None:
    client = FakeRedisClient()
    hub = make_hub(client=client)
    ws = FakeWebSocket()
    hub.register(ws, USER_B)
    hub.join(ws, CHAT_1)

    foreign = {"type": "typing", "chatId": CHAT_1, "userId": USER_A, "instance": "other-instance"}
    echo = {"type": "typing", "chatId": CHAT_1, "userId": USER_B, "instance": hub.instance_id}

    await hub._handle_channel_message(CHAT_CONTROL_CHANNEL, json.dumps(echo))
    assert ws.frames() == []  # our own publish round-trip: skipped

    await hub._handle_channel_message(CHAT_CONTROL_CHANNEL, json.dumps(foreign))
    assert [f["type"] for f in ws.frames()] == ["typing"]


async def test_pump_relay_valid_message_events_and_drops_malformed() -> None:
    client = FakeRedisClient()
    hub = make_hub(client=client)
    ws = FakeWebSocket()
    hub.register(ws, USER_B)
    hub.join(ws, CHAT_1)

    good = {"type": "message", "chatId": CHAT_1, "message": message_row(CHAT_1)}
    no_row = {"type": "message", "chatId": CHAT_1}
    bad_read = {"type": "messages_read", "chatId": CHAT_1, "readBy": USER_A, "readAt": "x", "messageIds": "nope"}
    good_read = {"type": "messages_read", "chatId": CHAT_1, "readBy": USER_A, "readAt": "x", "messageIds": ["m-1"]}

    for payload in (no_row, bad_read, good, good_read):
        await hub._handle_channel_message(CHAT_EVENTS_CHANNEL, json.dumps(payload))

    types = [f["type"] for f in ws.frames()]
    assert types == ["message", "messages_read"]  # only the well-formed ones


async def test_pump_ignores_garbage_and_other_channels() -> None:
    hub = make_hub()
    ws = FakeWebSocket()
    hub.register(ws, USER_A)
    hub.join(ws, CHAT_1)

    await hub._handle_channel_message(CHAT_EVENTS_CHANNEL, "not json at all")
    await hub._handle_channel_message(CHAT_EVENTS_CHANNEL, json.dumps({"nope": True}))
    await hub._handle_channel_message("some-other-channel", json.dumps({"type": "message", "chatId": CHAT_1}))
    await hub._handle_channel_message(CHAT_EVENTS_CHANNEL, None)

    assert ws.frames() == []


async def test_start_without_redis_is_a_local_only_noop() -> None:
    hub = make_hub(client=None)
    await hub.start()  # must not raise, must not start a pump
    assert hub._pump_task is None
    await hub.stop()  # and stop is safe too


async def test_is_participant_fails_closed_on_check_errors() -> None:
    async def boom(user_id: str, chat_id: str) -> bool:
        raise RuntimeError("db down")

    hub = ChatRealtimeHub(
        redis_gateway=FakeGateway(None),  # type: ignore[arg-type]
        participant_check=boom,
    )
    assert await hub.is_participant(USER_A, CHAT_1) is False


# ─── Endpoint: ticket authentication + join authorization over a real WS ────


@pytest.fixture
def ws_client(make_app: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    """TestClient with a fake Redis (for tickets + pubsub) and a fake
    participant store wired into the endpoint's imports."""
    from app.api.v1.endpoints import chat as chat_endpoint

    # chat_ws_max_frame_bytes pinned to its minimum so the 4009 test can use
    # a small frame instead of a 256KB one.
    settings = build_settings(cors_origins="http://localhost:3000", chat_ws_max_frame_bytes=1024)
    app = create_app(settings)

    client_store: FakeRedisClient = FakeRedisClient()
    fake_gateway = FakeGateway(client_store)
    participants: dict[str, tuple[str, str]] = {CHAT_1: (USER_A, USER_B)}

    async def fake_participant(user_id: str, chat_id: str) -> bool:
        pair = participants.get(chat_id)
        return pair is not None and user_id in pair

    # The hub singleton the endpoint resolves — real hub, fake dependencies.
    test_hub = ChatRealtimeHub(
        redis_gateway=fake_gateway,  # type: ignore[arg-type]
        participant_check=fake_participant,
    )
    monkeypatch.setattr(chat_endpoint, "get_redis_gateway", lambda: fake_gateway)
    monkeypatch.setattr(chat_endpoint, "get_chat_realtime_hub", lambda: test_hub)

    class Bundle:
        pass

    bundle = Bundle()
    bundle.app = app
    bundle.redis = client_store
    bundle.gateway = fake_gateway
    bundle.hub = test_hub
    bundle.participants = participants

    with TestClient(app) as test_client:
        bundle.client = test_client
        yield bundle


def mint(bundle: Any, ticket: str = TICKET, user_id: str = USER_A) -> None:
    """Store a ticket exactly as the Next.js ticket endpoint would."""
    bundle.redis.store[bundle.gateway.key("chat", "ws-ticket", ticket)] = user_id


def ticket_url(ticket: str = TICKET) -> str:
    return f"/api/v1/chat/ws?ticket={ticket}"


async def test_ws_rejects_missing_and_spent_tickets(ws_client: Any) -> None:
    from starlette.websockets import WebSocketDisconnect

    client: TestClient = ws_client.client

    # No ticket at all: accepted just long enough to send close 4401.
    with client.websocket_connect(ticket_url("")) as ws, pytest.raises(WebSocketDisconnect) as exc:
        ws.receive_json()
    assert exc.value.code == 4401

    # Malformed ticket shape: same rejection, no oracle about valid tickets.
    with client.websocket_connect(ticket_url("nothex!!")) as ws, pytest.raises(WebSocketDisconnect) as exc:
        ws.receive_json()
    assert exc.value.code == 4401

    # A valid ticket works once…
    mint(ws_client, TICKET, USER_A)
    with client.websocket_connect(ticket_url()) as ws:
        assert ws.receive_json()["type"] == "hello"

    # …and is spent afterwards (GETDEL): the second socket gets 4401.
    with client.websocket_connect(ticket_url()) as ws, pytest.raises(WebSocketDisconnect) as exc:
        ws.receive_json()
    assert exc.value.code == 4401


async def test_ws_hello_then_join_requires_participation(ws_client: Any) -> None:
    from starlette.websockets import WebSocketDisconnect

    mint(ws_client, TICKET, USER_A)

    with ws_client.client.websocket_connect(ticket_url()) as ws:
        hello = ws.receive_json()
        assert hello == {"type": "hello", "instanceId": ws_client.hub.instance_id}

        # A chat USER_A is not part of → rejected, and the socket survives.
        ws.send_json({"type": "join", "chatId": CHAT_2})
        event = ws.receive_json()
        assert event == {"type": "error", "code": "not_participant", "chatId": CHAT_2}

        # A non-UUID chat id → bad_message, socket survives.
        ws.send_json({"type": "join", "chatId": "not-a-uuid"})
        event = ws.receive_json()
        assert event == {"type": "error", "code": "bad_message"}

        # The chat USER_A IS part of → joined with a (empty) presence snapshot.
        ws.send_json({"type": "join", "chatId": CHAT_1})
        event = ws.receive_json()
        assert event == {"type": "joined", "chatId": CHAT_1, "onlineUserIds": []}

    # Exiting the session without an exception means the server never
    # force-closed the connection.


async def test_ws_two_users_message_and_typing_roundtrip(ws_client: Any) -> None:
    mint(ws_client, TICKET, USER_A)
    mint(ws_client, OTHER_TICKET, USER_B)

    with ws_client.client.websocket_connect(ticket_url(TICKET)) as ws_a, ws_client.client.websocket_connect(
        ticket_url(OTHER_TICKET)
    ) as ws_b:
        for ws in (ws_a, ws_b):
            assert ws.receive_json()["type"] == "hello"
            ws.send_json({"type": "join", "chatId": CHAT_1})

        joined_a = ws_a.receive_json()
        assert joined_a == {"type": "joined", "chatId": CHAT_1, "onlineUserIds": []}
        # A's own presence(online) echo (the room contained only A when it
        # joined; the client ignores its own presence).
        assert ws_a.receive_json()["type"] == "presence"

        # B joins while A is in the room: B's snapshot shows A online, and A
        # receives B's presence(online) broadcast (plus B's own echo).
        joined_b = ws_b.receive_json()
        assert joined_b["type"] == "joined"
        assert joined_b["onlineUserIds"] == [USER_A]
        assert ws_b.receive_json()["type"] == "presence"  # B's own echo
        presence = ws_a.receive_json()
        assert presence == {"type": "presence", "chatId": CHAT_1, "userId": USER_B, "online": True}

        # Typing: the room receives A's typing — including A's own socket
        # (the client filters its own events; the server keeps the loop
        # simple and uniform).
        ws_a.send_json({"type": "typing", "chatId": CHAT_1})
        typing = ws_b.receive_json()
        assert typing == {"type": "typing", "chatId": CHAT_1, "userId": USER_A}
        assert ws_a.receive_json()["type"] == "typing"  # A's own echo

        # A message event published to the events channel (what the Next.js
        # app does after a DB write) reaches both joined sockets — the pump
        # is not running here, so it is driven through the exact handler the
        # pump calls per message.
        await ws_client.hub._handle_channel_message(
            CHAT_EVENTS_CHANNEL,
            json.dumps({"type": "message", "chatId": CHAT_1, "message": message_row(CHAT_1)}),
        )
        got_a = ws_a.receive_json()
        got_b = ws_b.receive_json()
        assert got_a == {"type": "message", "chatId": CHAT_1, "message": message_row(CHAT_1)}
        assert got_b == got_a

        # A leaves: B gets presence(offline) and A gets `left`.
        ws_a.send_json({"type": "leave", "chatId": CHAT_1})
        left = ws_a.receive_json()
        assert left == {"type": "left", "chatId": CHAT_1}
        offline = ws_b.receive_json()
        assert offline == {"type": "presence", "chatId": CHAT_1, "userId": USER_A, "online": False}


async def test_ws_typing_is_throttled_server_side(ws_client: Any) -> None:
    mint(ws_client, TICKET, USER_A)
    mint(ws_client, OTHER_TICKET, USER_B)

    with ws_client.client.websocket_connect(ticket_url(TICKET)) as ws_a, ws_client.client.websocket_connect(
        ticket_url(OTHER_TICKET)
    ) as ws_b:
        for ws in (ws_a, ws_b):
            ws.receive_json()  # hello
            ws.send_json({"type": "join", "chatId": CHAT_1})
        ws_a.receive_json()  # joined
        ws_b.receive_json()  # joined
        ws_a.receive_json()  # presence(B online)

        # Three control publishes happened so far: A online, B online, and —
        # nothing else. Baseline for the throttle assertion.
        baseline = len(ws_client.redis.published)
        assert baseline == 2  # presence(A) + presence(B)

        ws_a.send_json({"type": "typing", "chatId": CHAT_1})
        ws_a.send_json({"type": "typing", "chatId": CHAT_1})  # inside window
        ws_a.send_json({"type": "typing", "chatId": CHAT_1})  # inside window

        # A leave acknowledgement is a processing barrier: without it,
        # send_json only enqueues frames and this assertion can race the
        # server (especially while other test suites are running).
        ws_a.send_json({"type": "leave", "chatId": CHAT_1})
        while ws_a.receive_json()["type"] != "left":
            pass  # drain presence/typing echoes before the acknowledgement

        # Exactly ONE of the three typing controls was published. Presence
        # may also be published when leaving, so count typing frames only.
        typing_publishes = [
            payload for _channel, payload in ws_client.redis.published[baseline:]
            if json.loads(payload).get("type") == "typing"
        ]
        assert len(typing_publishes) == 1


async def test_ws_oversized_frame_closes_4009(ws_client: Any) -> None:
    from starlette.websockets import WebSocketDisconnect

    mint(ws_client, TICKET, USER_A)

    big = json.dumps({"type": "typing", "chatId": CHAT_1, "padding": "x" * 4000})
    with pytest.raises(WebSocketDisconnect) as exc:  # noqa: SIM117 - must wrap connect to catch it
        with ws_client.client.websocket_connect(ticket_url()) as ws:
            ws.receive_json()  # hello
            ws.send_text(big)
            ws.receive_json()  # the close frame surfaces here
    assert exc.value.code == 4009


async def test_ws_unknown_type_counts_as_violation(ws_client: Any) -> None:
    from starlette.websockets import WebSocketDisconnect

    mint(ws_client, TICKET, USER_A)

    with pytest.raises(WebSocketDisconnect) as exc:  # noqa: SIM117 - must wrap connect to catch it
        with ws_client.client.websocket_connect(ticket_url()) as ws:
            ws.receive_json()  # hello
            for _ in range(3):
                ws.send_json({"type": "warp"})
                ws.receive_json()  # error: bad_message
            # After the third violation the server closes with 4003.
            ws.receive_json()
    assert exc.value.code == 4003


async def test_ws_ping_pong(ws_client: Any) -> None:
    mint(ws_client, TICKET, USER_A)

    with ws_client.client.websocket_connect(ticket_url()) as ws:
        ws.receive_json()  # hello
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


async def test_expired_or_spent_ticket_is_rejected_and_valid_ticket_is_user_bound(monkeypatch: Any) -> None:
    """Redis expiry and GETDEL both return no value; the ticket purpose is fixed."""
    from app.api.v1.endpoints import chat as chat_endpoint

    redis = FakeRedisClient()
    gateway = FakeGateway(redis)
    monkeypatch.setattr(chat_endpoint, "get_redis_gateway", lambda: gateway)
    key = gateway.key("chat", "ws-ticket", TICKET)
    redis.store[key] = USER_A
    assert await chat_endpoint.consume_ticket(TICKET) == USER_A
    assert await chat_endpoint.consume_ticket(TICKET) is None  # already GETDEL'd
    redis.store[key] = USER_B
    del redis.store[key]  # simulate Redis expiry at the issuer's 60-second TTL
    assert await chat_endpoint.consume_ticket(TICKET) is None
    redis.store[gateway.key("another-purpose", TICKET)] = USER_B
    assert await chat_endpoint.consume_ticket(TICKET) is None
