import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * The Phase 3 realtime contract at its most important seam: **chat-service
 * writes to Postgres first and publishes to Redis second** — and never the
 * other way round.
 *
 * This is the property that keeps Neon the source of truth and Redis a
 * notification bus (docs/SUPABASE-REMOVAL-PLAN.md §4). It is asserted by
 * ordering, not by inspection: the fake database transaction appends
 * `db:commit` only after the callback resolves, the fake Redis client appends
 * `redis:publish:<channel>` when the publish is issued, and each test asserts
 * the exact sequence — plus that a failed or unauthorized write publishes
 * nothing at all.
 *
 * `@/lib/prisma`, `@/lib/redis` and `@/services/notification-service` are
 * substituted at the module boundary; the real `chat-service` and the real
 * `chat-realtime-events` run.
 */

const USER_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const USER_B = "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d";
const CHAT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENTS_CHANNEL = "malihub:chat:events";

//: Shared, ordered record of everything the write path did.
let timeline: string[] = [];

type MessageRow = {
  id: string;
  chatId: string;
  senderId: string;
  content: string | null;
  imageUrl: string | null;
  readAt: Date | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
};

function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "m-1",
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

//: Test-controlled failures/behaviour for the fake database.
const db = {
  chat: { buyerId: USER_A, sellerId: USER_B },
  blocked: false,
  unreadIds: ["m-1", "m-2"] as string[],
  insertThrows: false,
  editRow: null as { senderId: string; deletedAt: Date | null; createdAt: Date } | null,
  deleteRow: null as { senderId: string } | null,
};

type TxClient = {
  message: { create: (args: unknown) => Promise<MessageRow> };
  chat: { update: (args: unknown) => Promise<unknown> };
};

const txClient: TxClient = {
  message: {
    create: async () => {
      if (db.insertThrows) throw new Error("insert failed");
      timeline.push("db:message.insert");
      return messageRow();
    },
  },
  chat: {
    update: async () => {
      timeline.push("db:chat.update");
      return {};
    },
  },
};

const prismaProxy = new Proxy({} as Record<string, unknown>, {
  get: (_target, property: string) => {
    switch (property) {
      case "$transaction":
        return async (callback: (tx: TxClient) => Promise<MessageRow>) => {
          const result = await callback(txClient);
          // The commit point: everything before this line is the write, and
          // nothing may be published until it has happened.
          timeline.push("db:commit");
          return result;
        };
      case "chat":
        return {
          findUnique: async () => db.chat,
          update: async () => {
            timeline.push("db:chat.update");
            return {};
          },
        };
      case "blockedUser":
        return { findFirst: async () => (db.blocked ? { id: "block-1" } : null) };
      case "message":
        return {
          count: async () => 0,
          findUnique: async () => db.editRow ?? db.deleteRow,
          update: async () => {
            timeline.push("db:message.update");
            return messageRow({
              content: db.editRow ? "edited" : null,
              editedAt: db.editRow ? new Date("2026-10-12T11:00:00.000Z") : null,
              deletedAt: db.editRow ? null : new Date("2026-10-12T11:00:00.000Z"),
            });
          },
          findMany: async () => db.unreadIds.map((id) => ({ id })),
          updateMany: async () => {
            timeline.push("db:message.updateMany");
            return { count: db.unreadIds.length };
          },
        };
      case "profile":
        return { findUnique: async () => ({ fullName: "Sender Name" }) };
      default:
        return undefined;
    }
  },
});

const redisProxy = {
  publish: async (channel: string) => {
    timeline.push(`redis:publish:${channel}`);
    return 1;
  },
};

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });
mock.module("@/lib/redis", { namedExports: { getRedis: () => redisProxy } });
mock.module("@/services/notification-service", { namedExports: { notifyUser: async () => undefined } });

let service: typeof import("@/services/chat-service");

before(async () => {
  service = await import("@/services/chat-service");
});

beforeEach(() => {
  timeline = [];
  db.chat = { buyerId: USER_A, sellerId: USER_B };
  db.blocked = false;
  db.insertThrows = false;
  db.unreadIds = ["m-1", "m-2"];
  db.editRow = null;
  db.deleteRow = null;
});

describe("chat-service — database first, Redis second", () => {
  it("publishes the message event only AFTER the transaction commits", async () => {
    const message = await service.sendMessage({ chatId: CHAT_1, senderId: USER_A, content: "hi" });

    assert.equal(message.id, "m-1");
    assert.deepEqual(timeline, [
      "db:message.insert",
      "db:chat.update",
      "db:commit",
      `redis:publish:${EVENTS_CHANNEL}`,
    ]);
  });

  it("publishes nothing when the write fails (the HTTP path still reports the error)", async () => {
    db.insertThrows = true;

    await assert.rejects(() => service.sendMessage({ chatId: CHAT_1, senderId: USER_A, content: "hi" }));

    // The insert itself is what threw, so nothing was written and nothing
    // was published: no `db:commit`, no Redis entry.
    assert.equal(timeline.length, 0);
    assert.equal(
      timeline.some((entry) => entry.startsWith("redis:publish")),
      false,
      "a failed write must never publish"
    );
  });

  it("publishes nothing when the sender is not a participant", async () => {
    db.chat = { buyerId: USER_B, sellerId: USER_B };

    await assert.rejects(() => service.sendMessage({ chatId: CHAT_1, senderId: USER_A, content: "hi" }));

    assert.equal(timeline.length, 0);
  });

  it("publishes nothing when the recipient has blocked the sender (or vice versa)", async () => {
    db.blocked = true;

    await assert.rejects(() => service.sendMessage({ chatId: CHAT_1, senderId: USER_A, content: "hi" }));

    assert.equal(timeline.length, 0);
  });

  it("editMessage publishes a message_update after the row update", async () => {
    db.editRow = { senderId: USER_A, deletedAt: null, createdAt: new Date() };

    await service.editMessage("m-1", USER_A, "edited");

    assert.deepEqual(timeline, ["db:message.update", `redis:publish:${EVENTS_CHANNEL}`]);
  });

  it("editMessage publishes nothing for another user's message", async () => {
    db.editRow = { senderId: USER_B, deletedAt: null, createdAt: new Date() };

    await assert.rejects(() => service.editMessage("m-1", USER_A, "hijack"));

    assert.equal(timeline.length, 0);
  });

  it("deleteMessage publishes the deleted row (content null) after the update", async () => {
    db.deleteRow = { senderId: USER_A };

    await service.deleteMessage("m-1", USER_A);

    assert.deepEqual(timeline, ["db:message.update", `redis:publish:${EVENTS_CHANNEL}`]);
  });

  it("markChatRead collects ids BEFORE the bulk update and publishes them", async () => {
    await service.markChatRead(CHAT_1, USER_A);

    assert.deepEqual(timeline, ["db:message.updateMany", `redis:publish:${EVENTS_CHANNEL}`]);
  });

  it("markChatRead with nothing unread is a silent no-op (no event, no write)", async () => {
    db.unreadIds = [];

    await service.markChatRead(CHAT_1, USER_A);

    assert.equal(timeline.length, 0);
  });
});
