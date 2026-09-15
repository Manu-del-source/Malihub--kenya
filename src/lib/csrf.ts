import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js Server Actions verify the request's Origin header against the
 * deployment's own origin automatically (has since 13.4, and is the exact
 * mechanism CVE-2025-29927 concerned itself with at the middleware layer —
 * see ARCHITECTURE.md §11a). Our own Server Actions (every actions.ts file
 * under (dashboard), (auth), and (marketplace)) inherit that for free.
 *
 * Plain Route Handlers under /api/* do not get this automatically — a
 * <form> or fetch() from a different origin can hit them same as any
 * same-origin request unless we check. This guard is for exactly that:
 * apply it at the top of any mutating (POST/PATCH/PUT/DELETE) API route.
 * GET routes never need it (CSRF is about *state-changing* requests).
 */
export function verifySameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return NextResponse.json({ success: false, error: "Missing Origin header." }, { status: 403 });
  }

  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get("host")}`;

  let originHost: string;
  let allowedHost: string;
  try {
    originHost = new URL(origin).host;
    allowedHost = new URL(allowedOrigin).host;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid Origin header." }, { status: 403 });
  }

  if (originHost !== allowedHost) {
    return NextResponse.json({ success: false, error: "Cross-origin request rejected." }, { status: 403 });
  }

  return null;
}
