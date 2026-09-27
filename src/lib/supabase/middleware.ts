import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * ─── RETAINED BUT INACTIVE — NOT PART OF THE AUTHENTICATION PATH ───────────
 * Nothing imports this module any more. `src/middleware.ts` validates sessions
 * through Neon Auth (`@/lib/auth/neon`), and no request reads or refreshes a
 * Supabase auth cookie.
 *
 * It is kept, unmodified, for one reason: it is part of the rollback target.
 * Restoring Supabase Auth means pointing middleware back at `updateSession()`
 * and reinstating the call sites listed in docs/auth/MIGRATION.md §9 — which is
 * only a quick revert if this file still exists exactly as it was.
 *
 * Do not "clean it up" and do not call it from new code. Deleting it is safe
 * only once the rollback window in MIGRATION.md §9 has closed.
 *
 * ─── Original purpose ──────────────────────────────────────────────────────
 * Refreshes the Supabase auth session on every request and mirrors the
 * updated cookies onto both the incoming request and outgoing response.
 * It used to be called from the root `middleware.ts` — keeping this logic
 * isolated made it easy to unit-test and kept middleware.ts itself declarative.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
