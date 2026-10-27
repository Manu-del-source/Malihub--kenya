import "server-only";
import { logServerError } from "@/lib/safe-log";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/services/notification-service";
import { publishChatEvent, toMessageRow } from "@/services/chat-realtime-events";
import type { Prisma } from "@prisma/client";

export class ChatServiceError extends Error {}

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_MESSAGES = 30; // ~1 every 2s sustained — generous for real conversation, tight for spam

/**
 * Confirms the user is buyer or seller on this chat. Every chat mutation
 * goes through this first — "never trust the client" means the chatId in
 * a request is just a hint, not proof of membership.
 */
async function assertParticipant(chatId: string, userId: string) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, buyerId: true, sellerId: true, buyerDeletedAt: true, sellerDeletedAt: true },
  });
  if (!chat || (chat.buyerId !== userId && chat.sellerId !== userId)) {
    throw new ChatServiceError("Conversation not found or you don't have access to it.");
  }
  return chat;
}

async function assertNotBlocked(userA: string, userB: string) {
  const block = await prisma.blockedUser.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
    select: { id: true },
  });
  if (block) {
    throw new ChatServiceError("You can't message this user.");
  }
}

async function assertUnderRateLimit(senderId: string) {
  const count = await prisma.message.count({
    where: {
      senderId,
      createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000) },
    },
  });
  if (count >= RATE_LIMIT_MAX_MESSAGES) {
    throw new ChatServiceError("You're sending messages too fast. Please slow down.");
  }
}

/** Finds or creates the (buyer, seller, product) chat — this triple is
 * unique per Phase 1's schema, so "starting a chat" is idempotent: message
 * a seller about the same listing twice and you land in the same thread. */
export async function getOrCreateChat(buyerId: string, sellerId: string, productId?: string) {
  if (buyerId === sellerId) {
    throw new ChatServiceError("You can't start a conversation with yourself.");
  }
  await assertNotBlocked(buyerId, sellerId);

  // Not `findUnique` on the `@@unique([buyerId, sellerId, productId])` triple:
  // Prisma types each field of a compound-unique input as non-nullable even
  // when the underlying column is optional, so the "general chat, no listing"
  // case (`productId` null) does not compile. `findFirst` over the same three
  // columns selects the same rows. The `orderBy` keeps it deterministic —
  // Postgres treats NULLs as distinct in a unique constraint, so a buyer and
  // seller can legitimately hold more than one listing-less chat, and without
  // an ordering the idempotency promised above would depend on scan order.
  const existing = await prisma.chat.findFirst({
    where: { buyerId, sellerId, productId: productId ?? null },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    const isBuyer = existing.buyerId === buyerId;
    if ((isBuyer && existing.buyerDeletedAt) || (!isBuyer && existing.sellerDeletedAt)) {
      return prisma.chat.update({
        where: { id: existing.id },
        data: isBuyer ? { buyerDeletedAt: null } : { sellerDeletedAt: null },
      });
    }
    return existing;
  }

  return prisma.chat.create({ data: { buyerId, sellerId, productId } });
}

export async function sendMessage(params: {
  chatId: string;
  senderId: string;
  content?: string;
  imageUrl?: string;
}) {
  const chat = await assertParticipant(params.chatId, params.senderId);
  const recipientId = chat.buyerId === params.senderId ? chat.sellerId : chat.buyerId;

  await assertNotBlocked(params.senderId, recipientId);
  await assertUnderRateLimit(params.senderId);

  const message = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.message.create({
      data: {
        chatId: params.chatId,
        senderId: params.senderId,
        content: params.content ?? null,
        imageUrl: params.imageUrl ?? null,
      },
    });
    await tx.chat.update({
      where: { id: params.chatId },
      data: {
        lastMessageAt: created.createdAt,
        ...(chat.buyerId === recipientId ? { buyerDeletedAt: null } : { sellerDeletedAt: null }),
      },
    });
    return created;
  });

  const sender = await prisma.profile.findUnique({
    where: { userId: params.senderId },
    select: { fullName: true },
  });
  notifyUser({
    userId: recipientId,
    type: "NEW_MESSAGE",
    title: `New message from ${sender?.fullName || "a MaliHub user"}`,
    body: params.content ? params.content.slice(0, 120) : "Sent you a photo",
    linkUrl: `/messages/${params.chatId}`,
  }).catch((error) => logServerError("Failed to send NEW_MESSAGE notification", error));

  // Realtime fan-out AFTER the write committed. The database is the source of
  // truth — this is a notification and is dropped (not fatal) if Redis is down.
  publishChatEvent({ type: "message", chatId: params.chatId, message: toMessageRow(message) });

  return message;
}

export async function editMessage(messageId: string, senderId: string, content: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true, deletedAt: true, createdAt: true },
  });
  if (!message || message.senderId !== senderId) {
    throw new ChatServiceError("Message not found or you don't have access to it.");
  }
  if (message.deletedAt) {
    throw new ChatServiceError("Can't edit a deleted message.");
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content, editedAt: new Date() },
  });
  publishChatEvent({ type: "message_update", chatId: updated.chatId, message: toMessageRow(updated) });
  return updated;
}

export async function deleteMessage(messageId: string, senderId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true },
  });
  if (!message || message.senderId !== senderId) {
    throw new ChatServiceError("Message not found or you don't have access to it.");
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content: null, imageUrl: null, deletedAt: new Date() },
  });
  publishChatEvent({ type: "message_update", chatId: updated.chatId, message: toMessageRow(updated) });
}

export async function markChatRead(chatId: string, userId: string) {
  const chat = await assertParticipant(chatId, userId);
  const readAt = new Date();
  // Collect the ids BEFORE the update so the realtime event can name them;
  // also skips the (and the event) when there is nothing to mark — no-op
  // writes churn nothing but would still publish a noisy empty event.
  const unread = await prisma.message.findMany({
    where: { chatId, senderId: { not: userId }, readAt: null },
    select: { id: true },
  });
  if (unread.length === 0) return chat;

  await prisma.message.updateMany({
    where: { chatId, senderId: { not: userId }, readAt: null },
    data: { readAt },
  });
  publishChatEvent({
    type: "messages_read",
    chatId,
    readBy: userId,
    readAt: readAt.toISOString(),
    messageIds: unread.map((m) => m.id),
  });
  return chat;
}

export async function setChatArchived(chatId: string, userId: string, archived: boolean) {
  const chat = await assertParticipant(chatId, userId);
  const isBuyer = chat.buyerId === userId;
  await prisma.chat.update({
    where: { id: chatId },
    data: isBuyer ? { buyerArchived: archived } : { sellerArchived: archived },
  });
}

export async function setChatDeleted(chatId: string, userId: string) {
  const chat = await assertParticipant(chatId, userId);
  const isBuyer = chat.buyerId === userId;
  await prisma.chat.update({
    where: { id: chatId },
    data: isBuyer ? { buyerDeletedAt: new Date() } : { sellerDeletedAt: new Date() },
  });
}

export async function blockUser(blockerId: string, blockedId: string) {
  if (blockerId === blockedId) {
    throw new ChatServiceError("You can't block yourself.");
  }
  await prisma.blockedUser.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    update: {},
    create: { blockerId, blockedId },
  });
}

export async function unblockUser(blockerId: string, blockedId: string) {
  await prisma.blockedUser.deleteMany({ where: { blockerId, blockedId } });
}

export async function isUserBlocked(userA: string, userB: string): Promise<boolean> {
  const block = await prisma.blockedUser.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
    select: { id: true },
  });
  return !!block;
}

// Only display fields cross the Server Component -> browser boundary. In
// particular, do not serialize the other participant's archive/deletion
// state, or full ProductImage rows (which contain storage identifiers).
const CHAT_LIST_SELECT = {
  id: true,
  buyerId: true,
  buyer: { select: { id: true, profile: { select: { fullName: true, avatarUrl: true } } } },
  seller: { select: { id: true, profile: { select: { fullName: true, avatarUrl: true } } } },
  product: { select: { title: true } },
  messages: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { content: true, imageUrl: true, deletedAt: true, createdAt: true },
  },
} satisfies Prisma.ChatSelect;

type ChatListRow = Prisma.ChatGetPayload<{ select: typeof CHAT_LIST_SELECT }>;

function toChatListItem(chat: ChatListRow, unreadCount: number) {
  const participant = (user: ChatListRow["buyer"]) => ({
    id: user.id,
    profile: user.profile ? { fullName: user.profile.fullName, avatarUrl: user.profile.avatarUrl } : null,
  });
  return {
    id: chat.id,
    buyerId: chat.buyerId,
    buyer: participant(chat.buyer),
    seller: participant(chat.seller),
    product: chat.product ? { title: chat.product.title } : null,
    messages: chat.messages.map((message) => ({
      content: message.content,
      imageUrl: message.imageUrl,
      deletedAt: message.deletedAt,
      createdAt: message.createdAt,
    })),
    unreadCount,
  };
}

export type ChatListItem = ReturnType<typeof toChatListItem>;

export async function getUserChats(userId: string, includeArchived = false): Promise<ChatListItem[]> {
  const chats = await prisma.chat.findMany({
    where: {
      OR: [{ buyerId: userId }, { sellerId: userId }],
      AND: [
        { OR: [{ buyerId: { not: userId } }, { buyerDeletedAt: null }] },
        { OR: [{ sellerId: { not: userId } }, { sellerDeletedAt: null }] },
        includeArchived
          ? {}
          : {
              OR: [
                { buyerId: { not: userId } },
                { AND: [{ buyerId: userId }, { buyerArchived: false }] },
              ],
            },
        includeArchived
          ? {}
          : {
              OR: [
                { sellerId: { not: userId } },
                { AND: [{ sellerId: userId }, { sellerArchived: false }] },
              ],
            },
      ],
    },
    select: CHAT_LIST_SELECT,
    orderBy: { lastMessageAt: "desc" },
  });

  const unreadCounts = await prisma.message.groupBy({
    by: ["chatId"],
    where: { chatId: { in: chats.map((c: (typeof chats)[number]) => c.id) }, senderId: { not: userId }, readAt: null },
    _count: { id: true },
  });
  const unreadByChat = new Map(
    unreadCounts.map((u: { chatId: string; _count: { id: number } }) => [u.chatId, u._count.id])
  );

  return chats.map((chat) => toChatListItem(chat, unreadByChat.get(chat.id) ?? 0));
}

export async function getChatMessages(chatId: string, userId: string, cursor?: string, pageSize = 30) {
  await assertParticipant(chatId, userId);

  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    select: { id: true, chatId: true, senderId: true, content: true, imageUrl: true, readAt: true, editedAt: true, deletedAt: true, createdAt: true },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = messages.length > pageSize;
  const page = hasMore ? messages.slice(0, pageSize) : messages;

  return {
    items: page.reverse().map((message) => ({
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      imageUrl: message.imageUrl,
      readAt: message.readAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
      createdAt: message.createdAt,
    })),
    nextCursor: hasMore ? page[0]?.id ?? null : null,
    hasMore,
  };
}
