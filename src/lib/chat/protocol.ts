/**
 * Wire protocol for the FastAPI-backed chat realtime surface
 * (`ws://…/api/v1/chat/ws`).
 *
 * ─── Rules of this channel (they exist because a bug here leaks data) ───────
 *
 * Identity is NEVER carried by the client. The browser first calls
 * `POST /api/chat/ws-ticket` (session-authenticated, rate-limited), which
 * stores a one-shot ticket in Upstash Redis and returns a WebSocket URL.
 * The FastAPI endpoint consumes the ticket (GETDEL — one use, short TTL)
 * and resolves the user id server-side. A client cannot claim another
 * user's identity on this socket.
 *
 * Every `join` is re-authorized against the database on the FastAPI side
 * (the user must be the buyer or seller of the chat). A client can open the
 * socket, but it cannot receive events for a chat it is not part of.
 *
 * Redis is a NOTIFICATION channel, not a store. Message events are published
 * by the Next.js chat-service AFTER the Prisma write succeeds — the database
 * (via the HTTP chat API) remains the source of truth. If Redis or the
 * WebSocket is down, chat degrades to HTTP polling + reload; nothing is
 * lost and no fallback broadcasts over an unauthenticated path.
 */

/** Redis channel the Next.js app publishes authoritative message events on. */
export const CHAT_EVENTS_CHANNEL = "malihub:chat:events";
/** Redis channel for cross-instance control events (typing, presence). */
export const CHAT_CONTROL_CHANNEL = "malihub:chat:control";
/**
 * Redis key prefix for one-shot WS tickets. Cross-stack contract with
 * `backend/app/api/v1/endpoints/chat.py` — both sides must keep the literal
 * `malihub:api:chat:ws-ticket:` prefix in sync.
 */
export const WS_TICKET_KEY_PREFIX = "malihub:api:chat:ws-ticket";

/** Hard cap on simultaneously joined chats per connection (mirrored server-side). */
export const MAX_JOINED_CHATS = 10;

// ─── Client → server ─────────────────────────────────────────────────────────

export interface JoinCommand {
  type: "join";
  chatId: string;
}
export interface LeaveCommand {
  type: "leave";
  chatId: string;
}
export interface TypingCommand {
  type: "typing";
  chatId: string;
}
export interface PingCommand {
  type: "ping";
}

export type ChatSocketCommand = JoinCommand | LeaveCommand | TypingCommand | PingCommand;

// ─── Message rows (same shape the HTTP API returns) ─────────────────────────

export interface ChatMessageRow {
  id: string;
  chatId: string;
  senderId: string;
  /** null once a message is deleted — the row (and its `deletedAt`) is kept. */
  content: string | null;
  imageUrl: string | null;
  readAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

// ─── Server → client ─────────────────────────────────────────────────────────

/** Sent right after the ticket is accepted; includes the presence snapshot. */
export interface HelloEvent {
  type: "hello";
  instanceId: string;
}

export interface JoinedEvent {
  type: "joined";
  chatId: string;
  /** Other participants already in the room (presence snapshot for the joiner). */
  onlineUserIds: string[];
}
export interface LeftEvent {
  type: "left";
  chatId: string;
}

export interface MessageEvent {
  type: "message";
  chatId: string;
  message: ChatMessageRow;
}
export interface MessageUpdateEvent {
  type: "message_update";
  chatId: string;
  message: ChatMessageRow;
}
/** A batch of messages was marked read by `readBy` (bulk update notification). */
export interface MessagesReadEvent {
  type: "messages_read";
  chatId: string;
  readBy: string;
  readAt: string;
  messageIds: string[];
}
export interface TypingEvent {
  type: "typing";
  chatId: string;
  userId: string;
}
export interface PresenceEvent {
  type: "presence";
  chatId: string;
  userId: string;
  online: boolean;
}
export interface PongEvent {
  type: "pong";
}
export interface ErrorEvent {
  type: "error";
  code:
    | "bad_message"
    | "not_participant"
    | "too_many_chats"
    | "rate_limited"
    | "chat_unavailable";
  chatId?: string;
}

export type ChatSocketEvent =
  | HelloEvent
  | JoinedEvent
  | LeftEvent
  | MessageEvent
  | MessageUpdateEvent
  | MessagesReadEvent
  | TypingEvent
  | PresenceEvent
  | PongEvent
  | ErrorEvent;

/**
 * Events the Next.js app publishes to `CHAT_EVENTS_CHANNEL` after an
 * authorized database write. Restricted to the three that matter — the
 * channel name is not an authorization boundary, but limiting the surface
 * limits the damage of a mis-publish.
 */
export type ChatRealtimeOutgoingEvent =
  | MessageEvent
  | MessageUpdateEvent
  | MessagesReadEvent;
