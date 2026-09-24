import Link from "next/link";
import {
  isNeonAuthPocEnabled,
  NEON_AUTH_POC_PROTECTED_PATH,
  NEON_AUTH_POC_PROXY_PATH,
  NEON_AUTH_POC_SIGN_IN_PATH,
  resolveNeonAuthBaseUrl,
} from "@/lib/neon-auth/config";
import { getNeonAuth } from "@/lib/neon-auth/server";
import { neonSignOutAction } from "./actions";
import { NeonAuthNotConfigured } from "./not-configured";
import { NeonSignOutForm } from "./poc-forms";
import { MaliHubIdentityProbe, NeonSessionPanel } from "./session-panels";
import { toNeonSessionView } from "./session-view";

export const dynamic = "force-dynamic";

/**
 * Neon Managed Better Auth POC — overview.
 *
 * Public on purpose: it must be able to show the *unauthenticated* state, which
 * is why the middleware protects only `${NEON_AUTH_POC_PROTECTED_PATH}`.
 *
 * @see docs/neon-auth-poc/REPORT.md
 */
export default async function NeonAuthTestPage() {
  if (!isNeonAuthPocEnabled()) {
    return <NeonAuthNotConfigured />;
  }

  const { data, error } = await getNeonAuth().getSession();
  const view = toNeonSessionView(data);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl">Neon Managed Better Auth — POC</h1>
        <p className="text-sm text-muted-foreground">
          Package <code>@neondatabase/auth</code>, Next.js App Router integration, mounted under{" "}
          <code>{NEON_AUTH_POC_PROXY_PATH}</code>. The upstream Auth URL is read from the
          server-side <code>NEON_AUTH_BASE_URL</code>/<code>NEON_AUTH_URL</code> variable only —
          the value in use is <code>{resolveNeonAuthBaseUrl() ?? "unset"}</code>, and it is never
          sent to the browser.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Session retrieval reported an error: {error.message}
        </p>
      )}

      {view.authenticated ? (
        <div className="flex flex-wrap gap-3">
          <Link
            href={NEON_AUTH_POC_PROTECTED_PATH}
            className="rounded-full bg-gradient-to-br from-primary-400 to-primary-600 px-5 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Open the protected test page
          </Link>
          <NeonSignOutForm action={neonSignOutAction} />
        </div>
      ) : (
        <Link
          href={NEON_AUTH_POC_SIGN_IN_PATH}
          className="self-start rounded-full bg-gradient-to-br from-primary-400 to-primary-600 px-5 py-2.5 text-sm font-medium text-primary-foreground"
        >
          Sign in / sign up with Neon Auth
        </Link>
      )}

      <NeonSessionPanel view={view} />
      <MaliHubIdentityProbe neonUserId={view.userId} />

      <details className="glass rounded-xl p-5 text-xs text-muted-foreground">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide">
          Mapped session payload (tokens omitted)
        </summary>
        <pre className="mt-3 overflow-x-auto">{JSON.stringify(view, null, 2)}</pre>
      </details>
    </div>
  );
}
