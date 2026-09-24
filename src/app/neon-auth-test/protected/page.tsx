import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  isNeonAuthPocEnabled,
  NEON_AUTH_POC_PROTECTED_PATH,
  NEON_AUTH_POC_SIGN_IN_PATH,
} from "@/lib/neon-auth/config";
import { getNeonAuth } from "@/lib/neon-auth/server";
import { NeonAuthNotConfigured } from "../not-configured";
import { NeonSessionPanel } from "../session-panels";
import { toNeonSessionView } from "../session-view";

export const dynamic = "force-dynamic";

/**
 * The POC's protected route.
 *
 * Two independent gates, deliberately:
 *  1. `src/middleware.ts` runs Neon Auth's `auth.middleware()` for this path,
 *     which validates the signed session cookie (and the upstream session as a
 *     fallback) and redirects anonymous visitors to the POC login page.
 *  2. This server component re-reads the session with `auth.getSession()` and
 *     redirects itself if there is none — a page must never depend on the
 *     middleware alone.
 *
 * The `x-neon-auth-middleware` header proves gate 1 ran: the SDK sets it on the
 * request it lets through.
 */
export default async function NeonAuthProtectedPage() {
  if (!isNeonAuthPocEnabled()) {
    return <NeonAuthNotConfigured />;
  }

  const { data, error } = await getNeonAuth().getSession();
  const view = toNeonSessionView(data);

  if (!view.authenticated) {
    redirect(
      `${NEON_AUTH_POC_SIGN_IN_PATH}?redirectTo=${encodeURIComponent(NEON_AUTH_POC_PROTECTED_PATH)}`
    );
  }

  const headerList = await headers();
  const middlewareVerified = headerList.get("x-neon-auth-middleware");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-500">
          Protected route
        </span>
        <h1 className="font-display text-2xl">You are signed in with Neon Auth</h1>
        <p className="text-sm text-muted-foreground">
          This page is only reachable with a valid Managed Better Auth session. Refresh the page —
          the session persists — then sign out and try again to see the redirect.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Session retrieval reported an error: {error.message}
        </p>
      )}

      <NeonSessionPanel view={view} />

      <section className="glass rounded-xl p-5 text-xs text-muted-foreground">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">
          Middleware evidence
        </h2>
        <p>
          <code>x-neon-auth-middleware</code>:{" "}
          <span className="font-mono text-foreground">
            {middlewareVerified ?? "absent (middleware did not run for this request)"}
          </span>
        </p>
      </section>

      <p className="text-xs text-muted-foreground">
        <Link className="text-primary-400 hover:underline" href="/neon-auth-test">
          Back to the POC overview
        </Link>
      </p>
    </div>
  );
}
