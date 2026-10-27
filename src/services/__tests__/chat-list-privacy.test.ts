import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
const secret = "synthetic-private-chat-data";
const now = new Date("2026-01-01T00:00:00Z");
let findManyArgs: unknown;
const chat = {
  id: "chat-1", buyerId: "buyer", sellerId: "seller",
  buyerArchived: true, sellerArchived: true, sellerDeletedAt: now,
  buyer: { id: "buyer", email: secret, profile: { fullName: "Buyer", avatarUrl: null, phone: secret } },
  seller: { id: "seller", email: secret, profile: { fullName: "Seller", avatarUrl: "https://example.test/avatar.jpg", phone: secret } },
  product: { title: "Coffee pot", images: [{ url: "https://example.test/image.jpg", cloudinaryId: secret }] },
  messages: [{ content: "Hello", imageUrl: null, deletedAt: null, createdAt: now, internalSecret: secret }],
};
const prisma = {
  chat: {
    findMany: async (args: unknown) => { findManyArgs = args; return [chat]; },
    findUnique: async () => ({ id: chat.id, buyerId: chat.buyerId, sellerId: chat.sellerId }),
  },
  message: {
    groupBy: async () => [{ chatId: "chat-1", _count: { id: 1 } }],
    findMany: async () => [{ id: "message-1", chatId: "chat-1", senderId: "buyer", content: "Hello", imageUrl: null, readAt: null, editedAt: null, deletedAt: null, createdAt: now, internalSecret: secret }],
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma } });
let service: typeof import("@/services/chat-service");
before(async () => { service = await import("@/services/chat-service"); });

describe("chat browser projections", () => {
  it("returns only required conversation-list fields for the scoped participant", async () => {
    const [item] = await service.getUserChats("buyer");
    assert.deepEqual((findManyArgs as { where: { OR: unknown } }).where.OR, [{ buyerId: "buyer" }, { sellerId: "buyer" }]);
    assert.equal(item!.buyer.profile!.fullName, "Buyer");
    assert.equal(item!.seller.profile!.fullName, "Seller");
    assert.equal(item!.product!.title, "Coffee pot");
    assert.equal(item!.messages[0]!.content, "Hello");
    assert.equal(item!.unreadCount, 1);
    assert.equal(JSON.stringify(item).includes(secret), false);
    for (const field of ["sellerId", "buyerArchived", "sellerArchived", "sellerDeletedAt"]) assert.equal(field in item!, false);
    assert.equal("images" in item!.product!, false);
  });

  it("allows message history only to participants and strips extra row fields", async () => {
    await assert.rejects(() => service.getChatMessages("chat-1", "stranger"), /don't have access/);
    const result = await service.getChatMessages("chat-1", "buyer");
    assert.equal(result.items[0]!.content, "Hello");
    assert.equal(result.items[0]!.senderId, "buyer");
    assert.equal(JSON.stringify(result).includes(secret), false);
  });
});
