import "server-only";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/services/notification-service";
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

  const existing = await prisma.chat.findUnique({
    where: { buyerId_sellerId_productId: { buyerId, sellerId, productId: productId ?? null } },
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
  }).catch((error) => console.error("Failed to send NEW_MESSAGE notification", error));

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

  return prisma.message.update({
    where: { id: messageId },
    data: { content, editedAt: new Date() },
  });
}

export async function deleteMessage(messageId: string, senderId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true },
  });
  if (!message || message.senderId !== senderId) {
    throw new ChatServiceError("Message not found or you don't have access to it.");
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { content: null, imageUrl: null, deletedAt: new Date() },
  });
}

export async function markChatRead(chatId: string, userId: string) {
  const chat = await assertParticipant(chatId, userId);
  await prisma.message.updateMany({
    where: { chatId, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
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

const CHAT_LIST_INCLUDE = {
  buyer: { select: { id: true, profile: { select: { fullName: true, avatarUrl: true } } } },
  seller: { select: { id: true, profile: { select: { fullName: true, avatarUrl: true } } } },
  product: { select: { id: true, title: true, slug: true, images: { take: 1, orderBy: { sortOrder: "asc" as const } } } },
  messages: { orderBy: { createdAt: "desc" as const }, take: 1 },
} satisfies Prisma.ChatInclude;

export type ChatListItem = Prisma.ChatGetPayload<{ include: typeof CHAT_LIST_INCLUDE }> & {
  unreadCount: number;
};

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
    include: CHAT_LIST_INCLUDE,
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

  return chats.map((chat: (typeof chats)[number]) => ({
    ...chat,
    unreadCount: unreadByChat.get(chat.id) ?? 0,
  }));
}

export async function getChatMessages(chatId: string, userId: string, cursor?: string, pageSize = 30) {
  await assertParticipant(chatId, userId);

  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = messages.length > pageSize;
  const page = hasMore ? messages.slice(0, pageSize) : messages;

  return {
    items: page.reverse(),
    nextCursor: hasMore ? page[0]?.id ?? null : null,
    hasMore,
  };
}
