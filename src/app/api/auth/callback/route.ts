import { NextResponse, type NextRequest } from "next/server";

/**
 * RETIRED — 410 Gone.
 *
 * This route used to be the single landing point for every Supabase
 * redirect-based flow: Google OAuth, "confirm your email" links, and "reset your
 * password" links all arrived here with a `code` param, which was exchanged for
 * a session via `supabase.auth.exchangeCodeForSession()` before forwarding on to
 * `next`.
 *
 * It is deliberately NOT part of the authentication path any more. Managed
 * Better Auth owns the whole handshake and calls back into its own endpoints on
 * the auth service, not into a MaliHub route:
 *
 *   - Google OAuth completes at `{NEON_AUTH_BASE_URL}/callback/google` and the
 *     browser is then returned to the `callbackURL` MaliHub supplied, with the
 *     session already established. `src/middleware.ts` lets that auth-return
 *     request through so the session cookie can be written.
 *   - Email-verification links land on the app page given as `callbackURL`
 *     (see `resendVerificationAction`), already verified.
 *   - Password-reset links land on `/reset-password?token=…`, and
 *     `resetPasswordAction` consumes the token directly.
 *
 * So there is nothing left for this route to exchange, and re-implementing a
 * code-for-session swap here would put a second, parallel authentication path
 * back into the app — exactly what the migration removes.
 *
 * Why 410 rather than 404 or a redirect: 410 says "this existed and is
 * permanently gone", which is the truthful answer for the verification and reset
 * emails already sitting in people's inboxes from before the cutover. A silent
 * redirect to /login would look like the link worked; a 404 would look like a
 * bug. The body below tells the person what to do instead.
 *
 * Retained as a route (rather than deleted) so those old links get this
 * explanation instead of Next's generic not-found page. Safe to remove entirely
 * once the previous provider's links have aged out — see
 * docs/auth/MIGRATION.md §9.
 */
export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  const loginUrl = `${origin}/login?error=${encodeURIComponent(
    "That sign-in link is from an older version of MaliHub and no longer works. Please sign in, or request a new link."
  )}`;

  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>This link has expired — MaliHub</title>
    <meta name="robots" content="noindex" />
  </head>
  <body style="margin:0;background:#0b0b0f;color:#f5f5f7;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
    <main style="max-width:34rem;margin:0 auto;padding:6rem 1.5rem;text-align:center;">
      <h1 style="font-size:1.5rem;font-weight:500;margin:0 0 0.75rem;">This link has expired</h1>
      <p style="font-size:0.95rem;line-height:1.6;color:#a1a1aa;margin:0 0 2rem;">
        It was issued by an older version of MaliHub sign-in and can no longer be
        completed. Nothing about your account has changed — please sign in again,
        or request a new verification or password-reset link.
      </p>
      <a href="${loginUrl}"
         style="display:inline-block;background:#f5f5f7;color:#0b0b0f;text-decoration:none;font-size:0.95rem;font-weight:500;padding:0.75rem 1.5rem;border-radius:9999px;">
        Go to sign in
      </a>
    </main>
  </body>
</html>`;

  return new NextResponse(body, {
    status: 410,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Never cached: this is a permanent answer for a dead endpoint, and a
      // shared cache replaying it for a future route at the same path would be
      // surprising.
      "cache-control": "no-store",
    },
  });
}
