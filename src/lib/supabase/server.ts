import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/supabase";

/**
 * Supabase clients for Server Components, Server Actions, and Route Handlers.
 *
 * `import "server-only"` makes the bundler REJECT any attempt to import this
 * module into a client bundle — the service-role key and the per-request
 * cookie store must never reach the browser (see AUTH_AUDIT.md §client/server
 * boundary). Client components use `@/lib/supabase/client` instead.
 */

/**
 * Cookie-backed, per-request Supabase client. This is the ONLY client that
 * may refresh the user's session (`refreshSession`) — it owns the auth
 * cookies. Must be created per-request (`cookies()` is request-scoped).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore because
            // middleware refreshes the session on every request instead.
          }
        },
      },
    },
  );
}

/**
 * Service-role client for privileged server-only operations (the app_metadata
 * mirror via the Admin API, admin actions, webhooks).
 *
 * - Uses NO cookie adapter: it must never read or write the user's session,
 *   so it can't be confused with the user-facing refresh path (§10).
 * - Fails loudly if `SUPABASE_SERVICE_ROLE_KEY` is unset, instead of
 *   producing an opaque "invalid JWT" later — a missing key is a
 *   configuration failure and must be diagnosable (AUTH_AUDIT.md §env).
 */
export function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. The service-role Supabase client cannot be created; the app_metadata mirror (and therefore sign-in) will fail. Set SUPABASE_SERVICE_ROLE_KEY in the server environment.",
    );
  }

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    },
  );
}
