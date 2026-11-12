"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startChatAction } from "@/app/(dashboard)/messages/actions";

export function StartChatButton({
  sellerId,
  productId,
  redirectTo,
  isLoggedIn,
}: {
  sellerId: string;
  productId: string;
  redirectTo: string;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleStartChat() {
    if (!isLoggedIn) {
      router.push(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
      return;
    }

    startTransition(async () => {
      const result = await startChatAction({ sellerId, productId });
      if (!result.success) {
        toast.error(result.error || "Could not start a conversation.");
        return;
      }
      router.push(`/messages/${result.data.chatId}`);
    });
  }

  return (
    <Button type="button" variant="outline" size="lg" className="w-full" onClick={handleStartChat} disabled={pending}>
      <MessageCircle className="h-4 w-4" aria-hidden />
      {pending ? "Opening chat…" : "Chat with seller"}
    </Button>
  );
}
