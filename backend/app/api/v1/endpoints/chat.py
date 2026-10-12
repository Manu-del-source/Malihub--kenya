"""Chat realtime endpoint — the FastAPI side of the WebSocket surface.

``/api/v1/chat/ws?ticket=…``

Authentication is a **one-shot ticket**, not a bearer token:

1. The browser (which cannot send its httpOnly session cookie across
   origins) calls the Next.js app's same-origin
   ``POST /api/chat/ws-ticket``. That endpoint is session-authenticated and
   rate-limited; it stores ``malihub:api:chat:ws-ticket:<ticket> = <userId>``
   in Redis with a 60-second TTL and hands the browser a URL containing the
   ticket (256 random bits).
2. This endpoint consumes the ticket with ``GETDEL`` — one use, then it is
   gone — and resolves the user id **server-side**. The wire never carries a
   client-asserted identity.
3. Every ``join`` is then re-authorized against the database (buyer or
   seller of the chat). A ticket grants a socket, never a room.

Frame rules enforced here: JSON only, bounded size (``chat_ws_max_frame_bytes``),
bounded joined-chats per connection (``chat_ws_max_chats_per_connection``),
server-side typing rate limit, and a receive watchdog (``chat_ws_watchdog_seconds``)
so a half-open connection cannot hold rooms and presence forever.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.core.redis import get_redis_gateway
from app.services.chat_realtime import get_chat_realtime_hub

# Channel contract (kept in `app/services/chat_realtime.py`, mirrored in
# `src/lib/chat/protocol.ts`): this endpoint consumes tickets and enforces
# join authorization; the hub's Redis pump handles `malihub:chat:events`
# and `malihub:chat:control` fan-out.

logger = logging.getLogger(__name__)

router = APIRouter()

TICKET_KEY_PARTS: tuple[str, str] = ("chat", "ws-ticket")
TICKET_PATTERN = re.compile(r"^[0-9a-f]{32,64}$")

# WS close codes (application range 4000-4999).
CLOSE_PROTOCOL = 4003
CLOSE_STALE = 4000
CLOSE_FRAME_TOO_LARGE = 4009
CLOSE_UNAUTHORIZED = 4401
CLOSE_MAX_CHATS = 4008

MAX_PROTOCOL_VIOLATIONS = 3


async def consume_ticket(ticket: str) -> str | None:
    """Exchange a one-shot ticket for the user id it was minted for.

    ``GETDEL`` makes the ticket single-use even under concurrent connects.
    Any failure (Redis down, bad shape, already spent, expired) resolves to
    ``None`` — the socket is then rejected. No client ever learns *why* a
    foreign ticket failed.
    """
    if not TICKET_PATTERN.fullmatch(ticket):
        return None
    gateway = get_redis_gateway()
    try:
        client = gateway.require()
    except Exception:
        return None
    key = gateway.key(*TICKET_KEY_PARTS, ticket)
    try:
        value = await client.getdel(key)
    except Exception as exc:
        logger.warning(
            "ws_ticket_consume_failed",
            extra={"event": "ws_ticket_consume_failed", "error_type": type(exc).__name__},
        )
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return value if isinstance(value, str) and value else None


def _chat_id_ok(value: object) -> bool:
    """Cheap shape check (a canonical UUID) before paying for a DB lookup."""
    import uuid as _uuid

    if not isinstance(value, str):
        return False
    try:
        _uuid.UUID(value)
    except ValueError:
        return False
    return True


@router.websocket("/chat/ws")
async def chat_websocket(websocket: WebSocket) -> None:
    settings = get_settings()
    hub = get_chat_realtime_hub()

    await websocket.accept()

    ticket = websocket.query_params.get("ticket") or ""
    user_id = await consume_ticket(ticket)
    if user_id is None:
        # Accepted only long enough to send the close code; no frames are
        # processed for this socket.
        await websocket.close(code=CLOSE_UNAUTHORIZED, reason="unauthorized")
        return

    hub.register(websocket, user_id)
    await websocket.send_json({"type": "hello", "instanceId": hub.instance_id})

    last_typing_at: dict[str, float] = {}
    violations = 0

    async def send_event(event: dict) -> None:
        await websocket.send_json(event)

    try:
        while True:
            try:
                raw = await asyncio.wait_for(
                    websocket.receive_text(), timeout=settings.chat_ws_watchdog_seconds
                )
            except TimeoutError:
                # The client missed its heartbeat window — treat the
                # connection as dead. The client's own pong timeout triggers
                # its reconnect, and presence cleanup happens in `finally`.
                await websocket.close(code=CLOSE_STALE, reason="stale")
                break

            if len(raw.encode("utf-8")) > settings.chat_ws_max_frame_bytes:
                await websocket.close(code=CLOSE_FRAME_TOO_LARGE, reason="frame too large")
                break

            try:
                command = json.loads(raw)
            except ValueError:
                command = None
            if not isinstance(command, dict) or not isinstance(command.get("type"), str):
                violations += 1
                await send_event({"type": "error", "code": "bad_message"})
                if violations >= MAX_PROTOCOL_VIOLATIONS:
                    await websocket.close(code=CLOSE_PROTOCOL, reason="protocol")
                    break
                continue

            cmd_type = command["type"]
            chat_id = command.get("chatId") if isinstance(command.get("chatId"), str) else None

            if cmd_type == "ping":
                await send_event({"type": "pong"})

            elif cmd_type == "join":
                if chat_id is None or not _chat_id_ok(chat_id):
                    violations += 1
                    await send_event({"type": "error", "code": "bad_message"})
                    continue
                if len(hub.joined_chats(websocket)) >= settings.chat_ws_max_chats_per_connection:
                    await send_event({"type": "error", "code": "too_many_chats", "chatId": chat_id})
                    continue
                if not await hub.is_participant(user_id, chat_id):
                    # No oracle: do not reveal whether the chat exists.
                    await send_event({"type": "error", "code": "not_participant", "chatId": chat_id})
                    continue
                _was_member, user_became_online = hub.join(websocket, chat_id)
                online = hub.online_others(chat_id, user_id)
                await send_event({"type": "joined", "chatId": chat_id, "onlineUserIds": online})
                # Announce presence only on the 0→1 transition (a second tab
                # joining does not flip anyone's badge).
                if user_became_online:
                    await hub.broadcast_control(
                        chat_id, {"type": "presence", "userId": user_id, "online": True}
                    )

            elif cmd_type == "leave":
                if chat_id is None:
                    violations += 1
                    await send_event({"type": "error", "code": "bad_message"})
                    continue
                was_member, user_went_offline = hub.leave(websocket, chat_id)
                if was_member:
                    await send_event({"type": "left", "chatId": chat_id})
                if user_went_offline:
                    await hub.broadcast_control(
                        chat_id, {"type": "presence", "userId": user_id, "online": False}
                    )

            elif cmd_type == "typing":
                if chat_id is None or chat_id not in hub.joined_chats(websocket):
                    # Not joined → nothing to type in. Not an error worth a
                    # close; drop silently (the client only sends typing for
                    # joined chats; this covers races with leave).
                    continue
                now = time.monotonic()
                if now - last_typing_at.get(chat_id, 0.0) < settings.chat_ws_typing_window_seconds:
                    continue
                last_typing_at[chat_id] = now
                await hub.broadcast_control(chat_id, {"type": "typing", "userId": user_id})

            else:
                violations += 1
                await send_event({"type": "error", "code": "bad_message"})
                if violations >= MAX_PROTOCOL_VIOLATIONS:
                    await websocket.close(code=CLOSE_PROTOCOL, reason="protocol")
                    break

    except WebSocketDisconnect:
        pass
    finally:
        # Presence cleanup: announce offline for each room where this socket
        # was the user's LAST connection (multi-tab: closing one tab of two
        # must not flip the other participant's badge).
        for chat_id, user_went_offline in hub.unregister(websocket):
            if user_went_offline:
                await hub.broadcast_control(
                    chat_id, {"type": "presence", "userId": user_id, "online": False}
                )
        last_typing_at.clear()
