import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * The browser-side WebSocket manager (`ws-client.ts`) and its frame parser.
 *
 * The parser is the client's "don't trust the wire" boundary — it must drop
 * anything that isn't a well-formed event, so a misbehaving (or malicious)
 * server cannot drive the thread's state with garbage. The manager is tested
 * over a fake `WebSocket` (and a stubbed `fetch` for the ticket) to prove the
 * lifecycle: one shared socket per tab, join-on-open, self-event filtering,
 * and release on last-unsubscribe.
 *
 * `node:crypto`-free; timers are real but every test tears down its manager
 * so no reconnect/heartbeat timer outlives the suite.
 */

import {
  ChatSocketManager,
  parseChatSocketEvent,
  type ChatSocketListener,
} from "@/lib/chat/ws-client";

const USER_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const USER_B = "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d";
const CHAT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function row(chatId: string, id = "m-1", senderId = USER_B) {
  return {
    id,
    chatId,
    senderId,
    content: "hi",
    imageUrl: null,
    readAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: "2026-10-12T10:00:00.000Z",
  };
}

// ─── frame parser ────────────────────────────────────────────────────────────

describe("parseChatSocketEvent", () => {
  it("parses a well-formed message event", () => {
    const ev = parseChatSocketEvent(JSON.stringify({ type: "message", chatId: CHAT_1, message: row(CHAT_1) }));
    assert.equal(ev?.type, "message");
  });

  it("drops a message whose row chatId disagrees with the envelope", () => {
    const ev = parseChatSocketEvent(
      JSON.stringify({ type: "message", chatId: CHAT_1, message: row("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") })
    );
    assert.equal(ev, null);
  });

  it("drops non-JSON and non-object frames", () => {
    assert.equal(parseChatSocketEvent("not json"), null);
    assert.equal(parseChatSocketEvent(JSON.stringify([1, 2])), null);
    assert.equal(parseChatSocketEvent(JSON.stringify("str")), null);
  });

  it("drops a message event missing its row", () => {
    assert.equal(parseChatSocketEvent(JSON.stringify({ type: "message", chatId: CHAT_1 })), null);
  });

  it("drops messages_read with a non-array of ids", () => {
    assert.equal(
      parseChatSocketEvent(
        JSON.stringify({ type: "messages_read", chatId: CHAT_1, readBy: USER_A, readAt: "t", messageIds: "x" })
      ),
      null
    );
  });

  it("accepts typing / presence / pong / error shapes", () => {
    assert.equal(parseChatSocketEvent(JSON.stringify({ type: "typing", chatId: CHAT_1, userId: USER_B }))?.type, "typing");
    assert.equal(
      parseChatSocketEvent(JSON.stringify({ type: "presence", chatId: CHAT_1, userId: USER_B, online: true }))?.type,
      "presence"
    );
    assert.equal(parseChatSocketEvent(JSON.stringify({ type: "pong" }))?.type, "pong");
    assert.equal(parseChatSocketEvent(JSON.stringify({ type: "error", code: "bad_message" }))?.type, "error");
  });
});

// ─── manager over a fake socket ─────────────────────────────────────────────

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closedWith: number | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code ?? null;
    this.readyState = 3;
    this.onclose?.();
  }
  terminate() {
    this.close();
  }

  // test helpers
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  deliver(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  sentCommands() {
    return this.sent.map((s) => JSON.parse(s));
  }
}

let manager: ChatSocketManager;
let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;
const unsubs: Array<() => void> = [];

beforeEach(() => {
  FakeWebSocket.instances = [];
  unsubs.length = 0;
  manager = new ChatSocketManager();
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
  // Ticket endpoint always succeeds.
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { url: "wss://fake.local/api/v1/chat/ws?ticket=abc" } }),
    }) as unknown as Response) as typeof fetch;
  // The manager uses the global WebSocket constructor and its OPEN constant.
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  // Tear down so no reconnect/heartbeat timer outlives the test.
  for (const u of unsubs) u();
  unsubs.length = 0;
  for (const ws of FakeWebSocket.instances) {
    ws.onclose = null;
    ws.onmessage = null;
  }
});

function track(fn: () => void) {
  unsubs.push(fn);
  return fn;
}

function listener(partial: Partial<ChatSocketListener>): ChatSocketListener {
  return {
    onMessageInsert: () => undefined,
    onMessageUpdate: () => undefined,
    onMessagesRead: () => undefined,
    onJoined: () => undefined,
    onTyping: () => undefined,
    onPresence: () => undefined,
    ...partial,
  };
}

describe("ChatSocketManager lifecycle", () => {
  it("opens a shared socket on first subscribe and joins on open", async () => {
    const inserted: unknown[] = [];
    const unsub = track(
      manager.subscribe(CHAT_1, USER_A, listener({ onMessageInsert: (m) => inserted.push(m) }))
    );
    // openSocket() is async (fetches a ticket); let it settle.
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(FakeWebSocket.instances.length, 1);
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    // On open the manager joins every active chat.
    assert.deepEqual(ws.sentCommands(), [{ type: "join", chatId: CHAT_1 }]);

    // A message for this chat reaches the listener.
    ws.deliver({ type: "message", chatId: CHAT_1, message: row(CHAT_1) });
    assert.equal(inserted.length, 1);

    unsub();
  });

  it("filters its own typing/presence/read events but forwards others'", async () => {
    const seen: { typing: string[]; presence: [string, boolean][]; reads: string[][] } = {
      typing: [],
      presence: [],
      reads: [],
    };
    const unsub = track(
      manager.subscribe(
        CHAT_1,
        USER_A,
        listener({
          onTyping: (u) => seen.typing.push(u),
          onPresence: (u, o) => seen.presence.push([u, o]),
          onMessagesRead: (_by, _at, ids) => seen.reads.push(ids),
        })
      )
    );
    await new Promise((r) => setTimeout(r, 0));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.sentCommands(); // join drained

    ws.deliver({ type: "typing", chatId: CHAT_1, userId: USER_A }); // self → dropped
    ws.deliver({ type: "typing", chatId: CHAT_1, userId: USER_B }); // other → forwarded
    ws.deliver({ type: "presence", chatId: CHAT_1, userId: USER_A, online: false }); // self → dropped
    ws.deliver({ type: "presence", chatId: CHAT_1, userId: USER_B, online: true }); // other → forwarded
    ws.deliver({ type: "messages_read", chatId: CHAT_1, readBy: USER_A, readAt: "t", messageIds: ["m-1"] }); // self → dropped
    ws.deliver({ type: "messages_read", chatId: CHAT_1, readBy: USER_B, readAt: "t", messageIds: ["m-1"] }); // other → forwarded

    assert.deepEqual(seen.typing, [USER_B]);
    assert.deepEqual(seen.presence, [[USER_B, true]]);
    assert.deepEqual(seen.reads, [["m-1"]]);
    unsub();
  });

  it("releases the socket when the last listener unsubscribes", async () => {
    const unsub = track(manager.subscribe(CHAT_1, USER_A, listener({})));
    await new Promise((r) => setTimeout(r, 0));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    unsub();
    assert.equal(ws.closedWith, 1000);
  });

  it("does not open a second socket for a second chat (shared connection)", async () => {
    track(manager.subscribe(CHAT_1, USER_A, listener({})));
    track(manager.subscribe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", USER_A, listener({})));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(FakeWebSocket.instances.length, 1);
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    // Both active chats are joined on open.
    const joins = ws.sentCommands().filter((c) => c.type === "join");
    assert.equal(joins.length, 2);
  });

  it("re-joins a chat when a new listener subscribes to an open socket", async () => {
    track(manager.subscribe(CHAT_1, USER_A, listener({})));
    await new Promise((r) => setTimeout(r, 0));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.sentCommands(); // initial join

    track(manager.subscribe(CHAT_1, USER_A, listener({})));
    // A second listener for the same chat re-sends join (idempotent server-side)
    // so it can receive the presence snapshot.
    const joins = ws.sentCommands().filter((c) => c.type === "join");
    assert.equal(joins.length, 2);
  });

  it("sendTyping is throttled per chat", async () => {
    track(manager.subscribe(CHAT_1, USER_A, listener({})));
    await new Promise((r) => setTimeout(r, 0));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.sentCommands(); // join

    manager.sendTyping(CHAT_1);
    manager.sendTyping(CHAT_1); // within 1.5s window → dropped
    const typings = ws.sentCommands().filter((c) => c.type === "typing");
    assert.equal(typings.length, 1);
  });
});
