import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getChatMessages, isUserBlocked } from "@/services/chat-service";
import { ChatThread } from "@/components/messaging/chat-thread";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Conversation" };

export default async function ChatThreadPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = await params;

  const { user } = await requireUser();

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
