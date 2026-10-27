import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
const secret = "synthetic-private-notification-field";
let signedIn = true;
let where: unknown;
let shouldFail = false;
mock.module("@/lib/auth", { namedExports: { getCurrentUser: async () => signedIn ? { user: { id: "buyer" } } : null } });
mock.module("@/lib/prisma", { namedExports: { prisma: {
  notification: {
    findMany: async (args: { where: unknown }) => {
      where = args.where;
      if (shouldFail) throw new Error(secret);
      return [{ id: "n-1", userId: secret, channel: secret, type: "NEW_MESSAGE", title: "New message", body: "Hello", linkUrl: "/messages/chat-1", isRead: false, createdAt: new Date("2026-01-01") }];
    },
    count: async () => 1,
  },
} } });
let route: typeof import("@/app/api/notifications/route");
before(async () => { route = await import("@/app/api/notifications/route"); });
beforeEach(() => { signedIn = true; shouldFail = false; });

describe("notification response minimization", () => {
  it("requires authentication", async () => {
    signedIn = false;
    assert.equal((await route.GET()).status, 401);
  });

  it("scopes to the current user and returns only display fields", async () => {
    const response = await route.GET();
    const body = await response.json();
    assert.deepEqual(where, { userId: "buyer" });
    assert.equal(body.data.unreadCount, 1);
    assert.equal(body.data.notifications[0].title, "New message");
    assert.equal(body.data.notifications[0].linkUrl, "/messages/chat-1");
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal("userId" in body.data.notifications[0], false);
    assert.equal("channel" in body.data.notifications[0], false);
  });

  it("does not return or log database exception contents", async () => {
    shouldFail = true;
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      const response = await route.GET();
      assert.equal(response.status, 500);
      assert.equal(JSON.stringify({ body: await response.json(), logged }).includes(secret), false);
    } finally {
      console.error = original;
    }
  });
});
