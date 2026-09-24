import { resolveNeonAuthBaseUrl, resolveNeonAuthCookieSecret } from "@/lib/neon-auth/config";

/**
 * Rendered by every POC page when Neon Auth is not configured (or when the POC
 * is disabled in production). No SDK call happens in this state, which is what
 * keeps the POC inert on any environment that has not opted in.
 */
export function NeonAuthNotConfigured() {
  const hasUrl = Boolean(resolveNeonAuthBaseUrl());
  const hasSecret = Boolean(resolveNeonAuthCookieSecret());

  return (
    <section className="glass flex flex-col gap-3 rounded-xl p-5 text-sm" data-testid="neon-poc-disabled">
      <h1 className="font-display text-lg">Neon Auth POC is not enabled here</h1>
      <p className="text-muted-foreground">
        This route is inert until it is explicitly configured. Nothing else in the application is
        affected: Supabase Auth remains the production identity provider.
      </p>
      <ul className="list-inside list-disc text-xs text-muted-foreground">
        <li>
          <code>NEON_AUTH_BASE_URL</code> (or <code>NEON_AUTH_URL</code>): {hasUrl ? "set" : "missing"}
        </li>
        <li>
          <code>NEON_AUTH_COOKIE_SECRET</code> (32+ characters): {hasSecret ? "set" : "missing"}
        </li>
        <li>
          <code>NEON_AUTH_POC_ENABLED</code>: required (<code>true</code>) only when{" "}
          <code>NODE_ENV=production</code>
        </li>
      </ul>
    </section>
  );
}
