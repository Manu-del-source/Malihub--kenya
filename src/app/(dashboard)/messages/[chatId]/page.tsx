import Link from "next/link";
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

function UnavailableConversation() {
  return (
    <div className="flex h-full items-center justify-center px-5 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center">
        <p className="font-display text-xl font-semibold text-foreground">
          Conversation unavailable
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This conversation is no longer available. It may have been removed or
          the account or listing connected to it is no longer active.
        </p>
        <Link
          href="/messages"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Back to Message Centre
        </Link>
      </div>
    </div>
  );
}

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

  // Notifications can outlive a conversation (for example, if an account
  // involved in the chat is removed). Only show this recovery screen to the
  // authenticated recipient of a NEW_MESSAGE notification for this exact URL.
  // Everyone else still gets a 404, so chat IDs cannot be used to probe records.
  if (!chat) {
    const ownsStaleNotification = await prisma.notification.findFirst({
      where: {
        userId: user.id,
        type: "NEW_MESSAGE",
        linkUrl: `/messages/${chatId}`,
      },
      select: { id: true },
    });

    if (!ownsStaleNotification) notFound();
    return <UnavailableConversation />;
  }

  if (chat.buyerId !== user.id && chat.sellerId !== user.id) {
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
