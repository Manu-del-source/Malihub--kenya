import { getNeonAuth } from "@/lib/neon-auth/server";
import { isNeonAuthPocEnabled } from "@/lib/neon-auth/config";

/**
 * Managed Better Auth proxy for the POC.
 *
 * The official Next.js integration mounts this catch-all at
 * `app/api/auth/[...path]/route.ts`. MaliHub already owns `/api/auth/callback`
 * for Supabase, so the POC mounts an isolated copy under its own prefix and the
 * root middleware never routes production traffic through it.
 *
 * All requests are forwarded to `NEON_AUTH_BASE_URL`; responses are returned
 * verbatim (including `Set-Cookie`), and the SDK additionally mints its signed
 * `__Secure-neon-auth.local.session_data` cookie so subsequent server reads do
 * not have to call Neon.
 *
 * @see https://neon.com/docs/auth/quick-start/nextjs-api-only
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

function notFound(): Response {
  return new Response("Neon Auth POC is not enabled.", { status: 404 });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  if (!isNeonAuthPocEnabled()) return notFound();
  const { GET } = getNeonAuth().handler();
  return GET(request, context);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!isNeonAuthPocEnabled()) return notFound();
  const { POST } = getNeonAuth().handler();
  return POST(request, context);
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  if (!isNeonAuthPocEnabled()) return notFound();
  const { PUT } = getNeonAuth().handler();
  return PUT(request, context);
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  if (!isNeonAuthPocEnabled()) return notFound();
  const { DELETE } = getNeonAuth().handler();
  return DELETE(request, context);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  if (!isNeonAuthPocEnabled()) return notFound();
  const { PATCH } = getNeonAuth().handler();
  return PATCH(request, context);
}
