import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserChats } from "@/services/chat-service";
import { MessagesShell } from "@/components/messaging/messages-shell";

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const chats = await getUserChats(user.id);

  return (
    <MessagesShell chats={chats} currentUserId={user.id}>
      {children}
    </MessagesShell>
  );
}
