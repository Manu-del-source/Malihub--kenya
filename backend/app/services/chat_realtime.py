"""Chat realtime hub: WebSocket rooms + cross-instance fan-out.

This is the server side of the chat realtime surface. It is deliberately a
*notification* layer:

* **The database is the source of truth.** Message rows are written by the
  Next.js app through the existing authorized HTTP chat API. After each
  successful write, Next.js publishes an event to the Redis channel
  ``malihub:chat:events``. This hub relays those events to the sockets
  currently joined to the chat — it never creates, edits, or stores
  messages itself.
* **Identity is resolved from a one-shot ticket.** The FastAPI endpoint
  consumes the ticket (Redis ``GETDEL``) before the socket is used for
  anything; the hub only ever sees the resulting user id, and re-checks
  chat membership (via the injected ``participant_check``) on every join.
  A client cannot subscribe to, or receive presence for, a chat it is not
  a part of.
* **Redis is a bus, not a store.** Multi-instance deployments each run this
  hub; the hub publishes control events (typing/presence) to
  ``malihub:chat:control`` and relays message events it receives, so every
  instance forwards events to its own local sockets. A Redis outage degrades
  an instance to local-only delivery (still correct for single-instance
  deployments; multi-instance clients simply miss cross-instance events
  until Redis recovers) — there is no fallback to an unauthenticated
  broadcast.

Presence is per-user, not per-socket: a user with two tabs in one chat is
"online" until both leave. The join ack carries a snapshot of the other
participants so a late joiner immediately sees who is already here.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import WebSocket
from sqlalchemy import or_, select

from app.core.redis import RedisGateway
from app.models.chat import Chat

logger = logging.getLogger(__name__)

#: Redis channels. Cross-stack contract with `src/lib/chat/protocol.ts` —
#: keep the literals in sync on both sides.
CHAT_EVENTS_CHANNEL = "malihub:chat:events"
CHAT_CONTROL_CHANNEL = "malihub:chat:control"

ParticipantCheck = Callable[[str, str], Awaitable[bool]]


class ChatRealtimeHub:
    """One hub per process; a set of per-chat rooms of live sockets."""

    def __init__(self, *, redis_gateway: RedisGateway, participant_check: ParticipantCheck) -> None:
        self._redis = redis_gateway
        self._participant_check = participant_check
        self._instance_id = uuid.uuid4().hex
        # chat_id → user_id → sockets. Presence is per USER, not per socket:
        # a user with two tabs is "online" until both leave, and only the
        # last socket's exit may announce an offline transition.
        self._room_users: dict[str, dict[str, set[WebSocket]]] = {}
        self._socket_user: dict[WebSocket, str] = {}
        self._pump_task: asyncio.Task[None] | None = None
        self._local_only_logged = False

    # ─── lifecycle ─────────────────────────────────────────────────────────

    @property
    def instance_id(self) -> str:
        return self._instance_id

    @property
    def is_multi_instance_capable(self) -> bool:
        return self._redis.client is not None

    async def start(self) -> None:
        """Start the Redis pump (no-op when Redis is unconfigured)."""
        if self._pump_task is not None:
            return
        client = self._redis.client
        if client is None:
            if not self._local_only_logged:
                logger.warning(
                    "chat_realtime_local_only",
                    extra={
                        "event": "chat_realtime_local_only",
                        "detail": (
                            "REDIS_URL is not set; chat realtime serves only this "
                            "instance's own sockets. Cross-instance delivery is off."
                        ),
                    },
                )
                self._local_only_logged = True
            return
        self._pump_task = asyncio.create_task(self._pump(client), name="chat-realtime-pump")

    async def stop(self) -> None:
        task, self._pump_task = self._pump_task, None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task

    # ─── rooms / authorization ─────────────────────────────────────────────

    async def is_participant(self, user_id: str, chat_id: str) -> bool:
        """The join gate. Fail-closed: any check failure means "not joined"."""
        try:
            return await self._participant_check(user_id, chat_id)
        except Exception as exc:
            logger.warning(
                "chat_participant_check_failed",
                extra={"event": "chat_participant_check_failed", "error_type": type(exc).__name__},
            )
            return False

    def register(self, ws: WebSocket, user_id: str) -> None:
        self._socket_user[ws] = user_id

    def unregister(self, ws: WebSocket) -> list[tuple[str, bool]]:
        """Remove a socket. Returns one ``(chat_id, user_went_offline)`` pair
        per room it was in. ``user_went_offline`` is True only when this was
        the user's LAST socket in that room — the caller broadcasts
        ``presence(offline)`` only for those, so closing one of two tabs does
        not flip the other participant's badge."""
        user_id = self._socket_user.pop(ws, None)
        if user_id is None:
            return []
        transitions: list[tuple[str, bool]] = []
        for chat_id, users in list(self._room_users.items()):
            sockets = users.get(user_id)
            if not sockets:
                continue
            sockets.discard(ws)
            if sockets:
                transitions.append((chat_id, False))
            else:
                del users[user_id]
                transitions.append((chat_id, True))
            if not users:
                del self._room_users[chat_id]
        return transitions

    def joined_chats(self, ws: WebSocket) -> list[str]:
        user_id = self._socket_user.get(ws)
        if user_id is None:
            return []
        return sorted(
            chat_id
            for chat_id, users in self._room_users.items()
            if ws in users.get(user_id, ())
        )

    def join(self, ws: WebSocket, chat_id: str) -> tuple[bool, bool]:
        """Idempotent join. Returns ``(was_member, user_became_online)``.
        ``user_became_online`` is True when this socket is the user's first
        in the room — the caller announces presence(online) only then."""
        user_id = self._socket_user.get(ws)
        if user_id is None:
            return (False, False)
        users = self._room_users.setdefault(chat_id, {})
        user_became_online = user_id not in users
        sockets = users.setdefault(user_id, set())
        was_member = ws in sockets
        sockets.add(ws)
        return (was_member, user_became_online)

    def leave(self, ws: WebSocket, chat_id: str) -> tuple[bool, bool]:
        """Idempotent leave. Returns ``(was_member, user_went_offline)``."""
        user_id = self._socket_user.get(ws)
        if user_id is None:
            return (False, False)
        users = self._room_users.get(chat_id)
        sockets = users.get(user_id) if users else None
        if not sockets:
            return (False, False)
        was_member = ws in sockets
        sockets.discard(ws)
        user_went_offline = False
        if sockets:
            pass
        else:
            del users[user_id]
            user_went_offline = True
        if chat_id in self._room_users and not self._room_users[chat_id]:
            del self._room_users[chat_id]
        return (was_member, user_went_offline)

    def online_others(self, chat_id: str, user_id: str) -> list[str]:
        """Other participants currently in the room (distinct users — the
        snapshot sent to a joining socket)."""
        users = self._room_users.get(chat_id)
        if not users:
            return []
        return sorted(other for other in users if other != user_id)

    # ─── delivery ──────────────────────────────────────────────────────────

    async def local_deliver(self, chat_id: str, payload: dict[str, Any]) -> int:
        """Send one event to every socket joined to the chat, on this
        instance. Dead sockets are logged, never fatal for the others.

        The `instance` field (used for echo-skipping on the control channel)
        is internal plumbing and is stripped before anything reaches a
        client — the wire protocol never carries it."""
        users = self._room_users.get(chat_id)
        if not users:
            return 0
        sockets = [ws for user_sockets in users.values() for ws in user_sockets]
        wire_payload = {k: v for k, v in payload.items() if k != "instance"}
        data = json.dumps(wire_payload)
        results = await asyncio.gather(
            *(ws.send_text(data) for ws in list(sockets)),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, BaseException):
                logger.warning(
                    "chat_deliver_failed",
                    extra={
                        "event": "chat_deliver_failed",
                        "error_type": type(result).__name__,
                        "chat_id": chat_id,
                    },
                )
        return len(sockets)

    async def broadcast_control(self, chat_id: str, event: dict[str, Any]) -> None:
        """Fan out a control event (typing/presence) to this chat's room on
        EVERY instance: local delivery here, Redis publish for the rest.

        The event is stamped with this instance's id so other instances'
        pumps (and this one's own, in single-instance setups where the
        publish round-trips) can recognize and skip echoes."""
        stamped = {**event, "chatId": chat_id, "instance": self._instance_id}
        await self.local_deliver(chat_id, stamped)
        client = self._redis.client
        if client is None:
            return
        try:
            await client.publish(CHAT_CONTROL_CHANNEL, json.dumps(stamped))
        except Exception as exc:
            # notification on other instances only; this instance already
            # delivered locally, and HTTP remains authoritative.
            logger.warning(
                "chat_control_publish_failed",
                extra={"event": "chat_control_publish_failed", "error_type": type(exc).__name__},
            )

    # ─── Redis pump (inbound) ──────────────────────────────────────────────

    async def _pump(self, client: Any) -> None:
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe(CHAT_EVENTS_CHANNEL, CHAT_CONTROL_CHANNEL)
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                await self._handle_channel_message(message.get("channel"), message.get("data"))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # the pump restarts on the next hub start. A dead pump only loses
            # cross-instance fan-out, never the HTTP path.
            logger.warning(
                "chat_realtime_pump_failed",
                extra={"event": "chat_realtime_pump_failed", "error_type": type(exc).__name__},
            )
        finally:
            with contextlib.suppress(Exception):
                await pubsub.aclose()

    async def _handle_channel_message(self, channel: Any, data: Any) -> None:
        try:
            payload = json.loads(data)
        except (TypeError, ValueError):
            return
        if not isinstance(payload, dict):
            return
        chat_id = payload.get("chatId")
        if not isinstance(chat_id, str) or not chat_id:
            return
        if channel == CHAT_EVENTS_CHANNEL:
            # Message events originate from the Next.js app after an
            # authorized write. Trust the shape, not the sender: anything
            # missing a `message` row is dropped, not broadcast.
            event_type = payload.get("type")
            if event_type in ("message", "message_update"):
                if not isinstance(payload.get("message"), dict):
                    return
                await self.local_deliver(chat_id, payload)
            elif event_type == "messages_read":
                if not isinstance(payload.get("messageIds"), list):
                    return
                await self.local_deliver(chat_id, payload)
        elif channel == CHAT_CONTROL_CHANNEL:
            # Control events include our own publishes; skip the echo.
            if payload.get("instance") == self._instance_id:
                return
            if payload.get("type") not in ("typing", "presence"):
                return
            await self.local_deliver(chat_id, payload)


# ─── singleton ──────────────────────────────────────────────────────────────

_hub: ChatRealtimeHub | None = None


def user_uuid(value: str) -> uuid.UUID:
    return uuid.UUID(value)


def get_chat_realtime_hub() -> ChatRealtimeHub:
    global _hub
    if _hub is None:
        from app.core.db import get_database
        from app.core.redis import get_redis_gateway

        async def db_participant_check(user_id: str, chat_id: str) -> bool:
            """Is `user_id` the buyer or seller of `chat_id`? Fail-closed."""
            database = get_database()
            if database.session_factory is None:
                # No database means no authorization source — the realtime
                # surface is off, and the HTTP chat API (which also needs the
                # DB) is off too, so nothing inconsistent is served.
                return False
            try:
                chat_uuid = uuid.UUID(chat_id)
            except ValueError:
                return False
            statement = (
                select(Chat.buyer_id)
                .where(Chat.id == chat_uuid)
                .where(or_(Chat.buyer_id == user_uuid(user_id), Chat.seller_id == user_uuid(user_id)))
                .limit(1)
            )
            try:
                async with database.session() as session:
                    row = (await session.execute(statement)).first()
                return row is not None
            except Exception as exc:
                # Log the exception TYPE only, never its text: driver errors
                # can embed the DSN and the bound user id.
                logger.warning(
                    "chat_participant_query_failed",
                    extra={"event": "chat_participant_query_failed", "error_type": type(exc).__name__},
                )
                return False

        _hub = ChatRealtimeHub(
            redis_gateway=get_redis_gateway(),
            participant_check=db_participant_check,
        )
    return _hub


def reset_chat_realtime_hub() -> None:
    """Test isolation: drop the cached singleton (the pump is a no-op without
    Redis, so a sync reset is safe in the suite)."""
    global _hub
    _hub = None
