import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@prisma/client";

/**
 * `chat-realtime-events.ts` — the fan-out point after an authorized chat
 * write, and the Prisma→wire row normalizer.
 *
 * The contract under test:
 *  - `toMessageRow` converts Prisma Date fields to ISO strings (exactly what
 *    the HTTP API delivers) and preserves `content: null` on deleted rows;
 *  - `publishChatEvent` is TOTAL — it never throws or rejects, because the
 *    database write has already committed and a Redis failure must only
 *    degrade realtime (the peer picks the row up on the next HTTP load).
 *
 * `@/lib/redis` is substituted; `server-only` is stubbed.
 */

mock.module("server-only", { namedExports: {} });

const published: { channel: string; payload: string }[] = [];
let redisMode: "ok" | "null" | "reject" = "ok";

mock.module("@/lib/redis", {
  namedExports: {
    getRedis: () =>
      redisMode === "null"
        ? null
        : {
            publish: async (channel: string, message: string) => {
              if (redisMode === "reject") throw new Error("redis down");
              published.push({ channel, payload: message });
              return 1;
            },
          },
  },
});

// Imported in `before` (after the module mocks are registered) — same
// pattern as the route boundary tests.
let service: typeof import("@/services/chat-realtime-events");

before(async () => {
  service = await import("@/services/chat-realtime-events");
});

const CHAT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function prismaMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    chatId: CHAT_1,
    senderId: USER_A,
    content: "hello",
    imageUrl: null,
    readAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-10-12T10:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  published.length = 0;
  redisMode = "ok";
});

describe("toMessageRow", () => {
  it("converts Date fields to ISO strings", () => {
    const row = service.toMessageRow(
      prismaMessage({ readAt: new Date("2026-10-12T11:30:00.500Z"), editedAt: new Date("2026-10-12T12:00:00.000Z") })
    );
    assert.equal(row.createdAt, "2026-10-12T10:00:00.000Z");
    assert.equal(row.readAt, "2026-10-12T11:30:00.500Z");
    assert.equal(row.editedAt, "2026-10-12T12:00:00.000Z");
    assert.equal(row.deletedAt, null);
  });

  it("preserves a deleted row (content null, deletedAt set)", () => {
    const row = service.toMessageRow(
      prismaMessage({ content: null, imageUrl: null, deletedAt: new Date("2026-10-12T13:00:00.000Z") })
    );
    assert.equal(row.content, null);
    assert.equal(row.deletedAt, "2026-10-12T13:00:00.000Z");
  });

  it("keeps scalar fields intact", () => {
    const row = service.toMessageRow(prismaMessage({ imageUrl: "https://res.cloudinary.com/x/image/upload/a.jpg" }));
    assert.equal(row.id, "11111111-1111-4111-8111-111111111111");
    assert.equal(row.chatId, CHAT_1);
    assert.equal(row.senderId, USER_A);
    assert.equal(row.content, "hello");
    assert.equal(row.imageUrl, "https://res.cloudinary.com/x/image/upload/a.jpg");
  });
});

describe("publishChatEvent", () => {
  it("publishes to the events channel with a JSON payload", () => {
    service.publishChatEvent({ type: "message", chatId: CHAT_1, message: service.toMessageRow(prismaMessage()) });
    assert.equal(published.length, 1);
    assert.equal(published[0]!.channel, "malihub:chat:events");
    const payload = JSON.parse(published[0]!.payload);
    assert.equal(payload.type, "message");
    assert.equal(payload.chatId, CHAT_1);
    assert.equal(payload.message.content, "hello");
  });

  it("is a silent no-op when Redis is not configured", () => {
    redisMode = "null";
    assert.doesNotThrow(() =>
      service.publishChatEvent({ type: "message_update", chatId: CHAT_1, message: service.toMessageRow(prismaMessage()) })
    );
    assert.equal(published.length, 0);
  });

  it("never throws when the publish itself fails (fire-and-forget)", async () => {
    redisMode = "reject";
    service.publishChatEvent({
      type: "messages_read",
      chatId: CHAT_1,
      readBy: USER_A,
      readAt: "2026-10-12T10:00:00.000Z",
      messageIds: ["m-1"],
    });
    // The rejection is handled internally (warn log); give the microtask a
    // tick to settle and prove nothing escaped as an unhandled rejection.
    await new Promise((r) => setTimeout(r, 10));
  });
});
