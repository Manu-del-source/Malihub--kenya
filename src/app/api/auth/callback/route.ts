import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
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
