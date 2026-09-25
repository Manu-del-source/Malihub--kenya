"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  sendMessageSchema,
  editMessageSchema,
  startChatSchema,
  type SendMessageInput,
  type EditMessageInput,
  type StartChatInput,
} from "@/lib/validations/chat";
import {
  getOrCreateChat,
  sendMessage,
  editMessage,
  deleteMessage,
  markChatRead,
  setChatArchived,
  setChatDeleted,
  blockUser,
  unblockUser,
  getChatMessages,
  ChatServiceError,
} from "@/services/chat-service";
import type { ApiResult, Message } from "@/types";

async function requireUser() {
  const user = (await getCurrentUser())?.user;
  if (!user) throw new ChatServiceError("Sign in required.");
  return user.id;
}

function toResult<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  return fn()
    .then((data) => ({ success: true as const, data }))
    .catch((error) => {
      if (error instanceof ChatServiceError) {
        return { success: false as const, error: error.message };
      }
      console.error("Chat action failed", error);
      return { success: false as const, error: "Something went wrong. Please try again." };
    });
}

export async function startChatAction(input: StartChatInput): Promise<ApiResult<{ chatId: string }>> {
  const parsed = startChatSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };

  return toResult(async () => {
    const buyerId = await requireUser();
    const chat = await getOrCreateChat(buyerId, parsed.data.sellerId, parsed.data.productId);
    return { chatId: chat.id };
  });
}

export async function sendMessageAction(input: SendMessageInput): Promise<ApiResult<{ id: string }>> {
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid message" };
  }

  return toResult(async () => {
    const senderId = await requireUser();
    const message = await sendMessage({ ...parsed.data, senderId });
    revalidatePath(`/messages/${parsed.data.chatId}`);
    revalidatePath("/messages");
    return { id: message.id };
  });
}

export async function editMessageAction(input: EditMessageInput): Promise<ApiResult<null>> {
  const parsed = editMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid message" };
  }

  return toResult(async () => {
    const senderId = await requireUser();
    await editMessage(parsed.data.messageId, senderId, parsed.data.content);
    return null;
  });
}

export async function deleteMessageAction(messageId: string): Promise<ApiResult<null>> {
  return toResult(async () => {
    const senderId = await requireUser();
    await deleteMessage(messageId, senderId);
    return null;
  });
}

export async function markChatReadAction(chatId: string): Promise<ApiResult<null>> {
  return toResult(async () => {
    const userId = await requireUser();
    await markChatRead(chatId, userId);
    return null;
  });
}

export async function archiveChatAction(chatId: string, archived: boolean): Promise<ApiResult<null>> {
  return toResult(async () => {
    const userId = await requireUser();
    await setChatArchived(chatId, userId, archived);
    revalidatePath("/messages");
    return null;
  });
}

export async function deleteChatAction(chatId: string): Promise<ApiResult<null>> {
  return toResult(async () => {
    const userId = await requireUser();
    await setChatDeleted(chatId, userId);
    revalidatePath("/messages");
    return null;
  });
}

export async function blockUserAction(otherUserId: string): Promise<ApiResult<null>> {
  return toResult(async () => {
    const userId = await requireUser();
    await blockUser(userId, otherUserId);
    revalidatePath("/messages");
    return null;
  });
}

export async function unblockUserAction(otherUserId: string): Promise<ApiResult<null>> {
  return toResult(async () => {
    const userId = await requireUser();
    await unblockUser(userId, otherUserId);
    return null;
  });
}

export async function isBlockedByMeAction(otherUserId: string): Promise<boolean> {
  const user = (await getCurrentUser())?.user;
  if (!user) return false;

  const block = await prisma.blockedUser.findUnique({
    where: { blockerId_blockedId: { blockerId: user.id, blockedId: otherUserId } },
  });
  return !!block;
}

export async function loadOlderMessagesAction(
  chatId: string,
  cursor?: string
): Promise<ApiResult<{ items: Message[]; nextCursor: string | null; hasMore: boolean }>> {
  return toResult(async () => {
    const userId = await requireUser();
    return getChatMessages(chatId, userId, cursor);
  });
}
