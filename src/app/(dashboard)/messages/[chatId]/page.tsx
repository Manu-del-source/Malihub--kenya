import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getChatMessages, isUserBlocked } from "@/services/chat-service";
import { ChatThread } from "@/components/messaging/chat-thread";

export const metadata: Metadata = { title: "Conversation" };

export default async function ChatThreadPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      buyer: { select: { id: true, profile: { select: { fullName: true, avatarUrl: true } } } },
      seller: { select: { id: true, profile: { select: { fullName: true, avatarUrl: true } } } },
      product: { select: { title: true } },
    },
  });

  if (!chat || (chat.buyerId !== user.id && chat.sellerId !== user.id)) {
    notFound();
  }

  const isBuyer = chat.buyerId === user.id;
  const otherUserRow = isBuyer ? chat.seller : chat.buyer;
  const otherUser = {
    id: otherUserRow.id,
    name: otherUserRow.profile?.fullName || "MaliHub user",
    avatarUrl: otherUserRow.profile?.avatarUrl ?? null,
  };

  const [{ items, nextCursor }, blocked] = await Promise.all([
    getChatMessages(chatId, user.id),
    isUserBlocked(user.id, otherUser.id),
  ]);

  return (
    <ChatThread
      chatId={chatId}
      currentUserId={user.id}
      otherUser={otherUser}
      productTitle={chat.product?.title}
      initialMessages={items}
      initialNextCursor={nextCursor}
      isBlocked={blocked}
    />
  );
}
