import { requireUser } from "@/lib/auth";
import { getUserChats } from "@/services/chat-service";
import { MessagesShell } from "@/components/messaging/messages-shell";

/**
 * Rendered per request — never prerendered.
 *
 * This route reads the current session, and a session is per-request state. The
 * declaration is explicit rather than incidental on purpose: the previous
 * implementation got it for free because constructing a Supabase client called
 * `cookies()`, which Next.js treats as an opt into dynamic rendering. Reading a
 * Neon Auth session does not always do that — when the auth environment is not
 * configured the read short-circuits before touching a cookie — so a build run
 * without those variables would happily prerender this page as a static redirect
 * to /login and ship it that way, signing every visitor out.
 *
 * This is also what the Neon Auth Next.js documentation requires of any Server
 * Component that reads a session. See docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  const chats = await getUserChats(user.id);

  return (
    <MessagesShell chats={chats} currentUserId={user.id}>
      {children}
    </MessagesShell>
  );
}
