import Link from "next/link";
import { isNeonAuthPocEnabled, NEON_AUTH_POC_PROTECTED_PATH } from "@/lib/neon-auth/config";
import { NeonAuthNotConfigured } from "../not-configured";
import { NeonSignInForm, NeonSignUpForm } from "../poc-forms";

export const dynamic = "force-dynamic";

/**
 * The POC's login page — the `loginUrl` Neon Auth's middleware redirects to.
 *
 * Both flows live here so a redirected visitor can either sign in or create the
 * dedicated test account. Signed-in visitors still see the forms (the POC is an
 * evaluation harness, not a product flow), but the landing page reports state.
 */
export default function NeonAuthSignInPage() {
  if (!isNeonAuthPocEnabled()) {
    return <NeonAuthNotConfigured />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl">Neon Auth POC — sign in</h1>
        <p className="text-sm text-muted-foreground">
          Email/password against Managed Better Auth. No Supabase call is made on this route.
        </p>
      </div>

      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        Use a <strong>dedicated test account</strong> (for example{" "}
        <code>neon-poc-&lt;something&gt;@example.com</code>). Do not sign in with a MaliHub production
        user, and do not reuse the address for anything else — the account exists only to evaluate
        Neon Auth and is not provisioned into MaliHub&rsquo;s <code>users</code>/<code>profiles</code> tables.
      </p>

      <div className="glass grid gap-8 rounded-xl p-6 sm:grid-cols-2">
        <NeonSignInForm />
        <NeonSignUpForm />
      </div>

      <p className="text-xs text-muted-foreground">
        Protected test page:{" "}
        <Link className="text-primary-400 hover:underline" href={NEON_AUTH_POC_PROTECTED_PATH}>
          {NEON_AUTH_POC_PROTECTED_PATH}
        </Link>{" "}
        ·{" "}
        <Link className="text-primary-400 hover:underline" href="/neon-auth-test">
          back to the POC overview
        </Link>
      </p>
    </div>
  );
}
