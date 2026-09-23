import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { provisionUserRows } from "@/services/auth-service";

/**
 * Single callback for every Supabase redirect-based flow: Google OAuth,
 * "confirm your email" links, and "reset your password" links all point
 * here with a `code` param, then get forwarded on via `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/complete-profile";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // OAuth and email-confirmation sign-ups arrive here without ever passing
      // through a Server Action, so this is the only place to provision their
      // application rows. Best-effort: /complete-profile provisions them
      // authoritatively on submit if this is skipped or fails.
      if (data.user) {
        await provisionUserRows(data.user, "auth callback");
      }
      return NextResponse.redirect(`${origin}${next}`);
    }

    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("That link has expired or was already used.")}`
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Missing verification code.")}`
  );
}
