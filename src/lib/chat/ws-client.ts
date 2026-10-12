"use client";

import {
  MAX_JOINED_CHATS,
  type ChatMessageRow,
  type ChatSocketCommand,
  type ChatSocketEvent,
} from "@/lib/chat/protocol";

/**
 * Browser-side manager for the FastAPI chat WebSocket.
 *
 * One connection per tab (per user), shared by every mounted chat thread via
 * `subscribe()`. A thread joins/leaves rooms on the socket as it comes and
 * goes, so switching chats never duplicates subscriptions — the server also
 * enforces the same shape (join is idempotent, `MAX_JOINED_CHATS` cap).
 *
 * Identity never travels in frames: the socket URL carries a one-shot ticket
 * issued by the session-authenticated `POST /api/chat/ws-ticket` endpoint.
 * The server resolves the user id from the ticket and re-authorizes every
 * `join` against the database.
 *
 * Degradation: if the ticket endpoint is unreachable or returns an error
 * (realtime not configured, Redis down, rate-limited), the manager stays
 * inactive — chat threads continue to work over HTTP. A failed connection
 * retries with exponential backoff (capped), and gives up after a bounded
 * number of attempts; the next `subscribe()` re-arms it.
 */

export interface ChatSocketListener {
  onMessageInsert(message: ChatMessageRow): void;
  onMessageUpdate(message: ChatMessageRow): void;
  /** Bulk read-status notification (the ids are for THIS chat). */
  onMessagesRead(readBy: string, readAt: string, messageIds: string[]): void;
  /** Called on `joined` (and re-join) with the other participants' snapshot. */
  onJoined(onlineUserIds: string[]): void;
  onTyping(userId: string): void;
  onPresence(userId: string, online: boolean): void;
}

type SocketStatus = "inactive" | "connecting" | "open";

const TICKET_ENDPOINT = "/api/chat/ws-ticket";
const HEARTBEAT_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 65_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;
/** Client-side throttle; the server enforces its own (independent) limit. */
const TYPING_THROTTLE_MS = 1_500;
const TICKET_RETRY_MS = 30_000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Minimal structural validation of inbound frames — anything else is dropped.
 * Exported (not just for tests): this is the client-side "don't trust the
 * wire" boundary, and its contract is the same on every tab.
 */
export function parseChatSocketEvent(raw: string): ChatSocketEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const ev = parsed as Record<string, unknown>;
  if (!isNonEmptyString(ev.type)) return null;

  switch (ev.type) {
    case "joined":
      if (
        !isNonEmptyString(ev.chatId) ||
        !Array.isArray(ev.onlineUserIds) ||
        ev.onlineUserIds.some((v) => typeof v !== "string")
      ) {
        return null;
      }
      return ev as unknown as ChatSocketEvent;
    case "left":
      return isNonEmptyString(ev.chatId) ? (ev as unknown as ChatSocketEvent) : null;
    case "message":
    case "message_update": {
      const msg = ev.message as Record<string, unknown> | undefined;
      if (
        !isNonEmptyString(ev.chatId) ||
        typeof msg !== "object" ||
        msg === null ||
        !isNonEmptyString(msg.id) ||
        !isNonEmptyString(msg.chatId) ||
        msg.chatId !== ev.chatId
      ) {
        return null;
      }
      return ev as unknown as ChatSocketEvent;
    }
    case "messages_read":
      if (
        !isNonEmptyString(ev.chatId) ||
        !isNonEmptyString(ev.readBy) ||
        !isNonEmptyString(ev.readAt) ||
        !Array.isArray(ev.messageIds) ||
        ev.messageIds.some((v) => typeof v !== "string")
      ) {
        return null;
      }
      return ev as unknown as ChatSocketEvent;
    case "typing":
    case "presence":
      if (!isNonEmptyString(ev.chatId) || !isNonEmptyString(ev.userId)) return null;
      return ev as unknown as ChatSocketEvent;
    case "pong":
      return ev as unknown as ChatSocketEvent;
    case "error":
      return isNonEmptyString(ev.code) ? (ev as unknown as ChatSocketEvent) : null;
    case "hello":
    default:
      return ev as unknown as ChatSocketEvent;
  }
}

export class ChatSocketManager {
  /** chatId → listeners currently interested in that chat. */
  private listeners = new Map<string, Set<ChatSocketListener>>();
  /** chatIds we have joined on the open socket (server-acked). */
  private joined = new Set<string>();
  private ws: WebSocket | null = null;
  private status: SocketStatus = "inactive";
  private selfUserId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private intentionalClose = false;
  private lastTypingSent = new Map<string, number>();

  /**
   * Subscribe to a chat's events. Returns an unsubscribe function.
   * The first subscription for a tab opens the shared socket (lazy).
   */
  subscribe(chatId: string, userId: string, listener: ChatSocketListener): () => void {
    if (!isNonEmptyString(chatId) || !isNonEmptyString(userId)) return () => undefined;
    this.selfUserId = userId;

    let set = this.listeners.get(chatId);
    if (!set) {
      set = new Set();
      this.listeners.set(chatId, set);
    }
    set.add(listener);

    // A new listener for an already-open, already-joined chat still needs the
    // presence snapshot — sending `join` again is safe (server-side idempotent).
    if (this.status === "open" && this.ws) {
      this.send({ type: "join", chatId });
    }
    this.ensureConnected();

    return () => {
      const current = this.listeners.get(chatId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(chatId);
        this.joined.delete(chatId);
        if (this.status === "open") {
          this.send({ type: "leave", chatId });
        }
        if (this.listeners.size === 0) {
          // Nothing left in this tab — release the connection (and with it
          // the server-side presence) instead of holding an idle socket.
          this.closeIntentionally();
        }
      }
    };
  }

  /** Broadcast "I'm typing" for a chat. Throttled client-side; the server
   *  enforces its own independent limit, so this is comfort, not security. */
  sendTyping(chatId: string): void {
    const now = Date.now();
    const last = this.lastTypingSent.get(chatId) ?? 0;
    if (now - last < TYPING_THROTTLE_MS) return;
    this.lastTypingSent.set(chatId, now);
    this.send({ type: "typing", chatId });
  }

  // ── connection lifecycle ──────────────────────────────────────────────────

  private ensureConnected(): void {
    if (this.listeners.size === 0) return;
    if (this.status !== "inactive") return;
    // A previous run gave up; re-arm on fresh interest.
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.status = "connecting";
    this.intentionalClose = false;

    void this.openSocket().catch(() => {
      // Ticket fetch or WebSocket construction failed (offline, realtime
      // unconfigured, Redis down). Chat keeps working over HTTP; retry once
      // after a cooldown rather than hammering the endpoint.
      this.teardownSocket();
      if (this.listeners.size > 0 && this.status !== "open") {
        this.scheduleTicketRetry();
      }
    });
  }

  private async openSocket(): Promise<void> {
    const res = await fetch(TICKET_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`ticket request failed: ${res.status}`);
    const body = (await res.json()) as {
      success?: boolean;
      data?: { url?: string };
      error?: string;
    };
    const url = body.data?.url;
    if (!body.success || !url) throw new Error(body.error ?? "no ws url in ticket response");

    const ws = new WebSocket(url);
    // Between construction and onopen the socket is not ours yet — a failure
    // here lands in openSocket's reject, and teardown only touches `this.ws`
    // once it has been assigned in onopen.
    ws.onopen = () => {
      this.ws = ws;
      this.status = "open";
      this.intentionalClose = false;
      this.reconnectAttempts = 0;
      this.lastPongAt = Date.now();
      for (const chatId of this.listeners.keys()) {
        this.send({ type: "join", chatId });
      }
      this.startHeartbeat();
    };
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const parsed = parseChatSocketEvent(event.data);
      if (parsed) this.dispatchEvent(parsed);
    };
    ws.onclose = () => {
      this.teardownSocket();
      if (this.intentionalClose || this.listeners.size === 0) return;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose always follows; nothing to do here.
    };
  }

  private teardownSocket(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws = null;
    }
    if (this.status !== "inactive") {
      this.status = "inactive";
    }
    this.joined.clear();
  }

  private closeIntentionally(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    const ws = this.ws;
    this.teardownSocket();
    if (ws) {
      try {
        ws.close(1000, "client cleanup");
      } catch {
        // Already closing — nothing to do.
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private scheduleTicketRetry(): void {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.listeners.size > 0 && this.status === "inactive") {
        this.ensureConnected();
      }
    }, TICKET_RETRY_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.status !== "open") return;
      if (Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
        // The server's watchdog will drop this socket too; closing locally
        // fires onclose so the reconnect path (with re-join) starts sooner.
        // (The browser WebSocket has no `terminate()` — `close()` is the
        // only client-side teardown.)
        try {
          this.ws.close();
        } catch {
          // Already closing — nothing to do.
        }
        return;
      }
      this.send({ type: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(command: ChatSocketCommand): void {
    if (this.status !== "open" || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (
      (command.type === "join" || command.type === "leave") &&
      this.listeners.size > MAX_JOINED_CHATS
    ) {
      return; // Defensive: the server caps this too and tells us with an error.
    }
    try {
      this.ws.send(JSON.stringify(command));
    } catch {
      // The close handler will sort out the connection state.
    }
  }

  // ── inbound events ────────────────────────────────────────────────────────

  private dispatchEvent(event: ChatSocketEvent): void {
    const self = this.selfUserId;
    switch (event.type) {
      case "joined":
        this.joined.add(event.chatId);
        for (const listener of this.listeners.get(event.chatId) ?? []) {
          listener.onJoined(event.onlineUserIds);
        }
        break;
      case "left":
        this.joined.delete(event.chatId);
        break;
      case "message":
        for (const listener of this.listeners.get(event.chatId) ?? []) {
          listener.onMessageInsert(event.message);
        }
        break;
      case "message_update":
        for (const listener of this.listeners.get(event.chatId) ?? []) {
          listener.onMessageUpdate(event.message);
        }
        break;
      case "messages_read":
        if (event.readBy === self) break; // Our own reads are already reflected locally.
        for (const listener of this.listeners.get(event.chatId) ?? []) {
          listener.onMessagesRead(event.readBy, event.readAt, event.messageIds);
        }
        break;
      case "typing":
        if (event.userId === self) break; // Never show yourself as typing.
        for (const listener of this.listeners.get(event.chatId) ?? []) {
          listener.onTyping(event.userId);
        }
        break;
      case "presence":
        if (event.userId === self) break;
        for (const listener of this.listeners.get(event.chatId) ?? []) {
          listener.onPresence(event.userId, event.online);
        }
        break;
      case "pong":
        this.lastPongAt = Date.now();
        break;
      case "hello":
        break;
      case "error":
        // Logged, never fatal: the server closes on violations it considers
        // fatal; everything else (e.g. a join we were not part of) is simply
        // denied and the thread keeps working over HTTP.
        console.warn(`[chat-socket] server error: ${event.code}${event.chatId ? ` (chat ${event.chatId})` : ""}`);
        break;
      default:
        break;
    }
  }
}

/**
 * The per-tab singleton. Server-rendered pages never import this module from
 * server code (the only consumer is a "use client" hook), so the WebSocket
 * globals are guaranteed available.
 */
export const chatSocket = new ChatSocketManager();
