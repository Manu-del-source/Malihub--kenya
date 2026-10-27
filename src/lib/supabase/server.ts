import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/supabase";

/**
 * ─── RETAINED FOR ROLLBACK. NOT PART OF THE LIVE REQUEST PATH. ─────────────
 * Nothing imports this module except `src/lib/supabase/auth-legacy.ts`, which
 * is itself unreferenced. It exists so restoring Supabase Auth (the documented
 * rollback in docs/auth/MIGRATION.md §9) does not depend on archaeology in git
 * history. Do not "clean it up", and do not import it from new code.
 *
 * Phase 4 note: `@supabase/supabase-js` — the peer dependency `@supabase/ssr`
 * builds its clients on — was removed from package.json once its last active
 * importer (the browser Realtime client) was deleted; with `legacy-peer-deps`
 * in .npmrc npm does not reinstall a peer automatically. Restoring this path
 * therefore begins with `npm install @supabase/supabase-js@2.117.3`, and with
 * the `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` values
 * `.env.example` still documents.
 */

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Must be created per-request (cookies() is request-scoped).
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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore because
            // middleware refreshes the session on every request instead.
          }
        },
      },
    }
  );
}

/**
 * Service-role client for privileged server-only operations
 * (admin actions, webhooks). NEVER import this in client code.
 */
export function createServiceRoleClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    }
  );
}
