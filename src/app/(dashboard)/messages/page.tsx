import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesIndexPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessageCircle className="h-6 w-6" aria-hidden />
      </div>
      <p className="font-medium text-foreground">Select a conversation</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Choose a conversation from the list, or message a seller from any listing to start a new one.
      </p>
    </div>
  );
}
