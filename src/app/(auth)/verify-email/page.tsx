import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";
import { getAuthContext } from "@/lib/auth";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify your email",
};

/**
 * Post-registration verification screen.
 *
 * Reached from the register form as `/verify-email?email=…`. The address is also
 * recoverable from the session, because sign-up establishes one — which matters
 * for anybody who lands here from a bookmark or a refresh, with no query string.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const { identity } = await getAuthContext();

  // Prefer the session's own address over the query string: the parameter is
  // attacker-influenced, and sending a code to an address typed into a URL would
  // let one person trigger mail to another.
  const email = identity?.email ?? params.email?.trim().toLowerCase() ?? null;

  if (!email) {
    return (
      <AuthCard
        title="Verify your email"
        subtitle="We couldn't tell which address needs verifying."
        footer={
          <>
            Already registered?{" "}
            <Link href="/login" className="text-primary-400 hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <p className="py-2 text-center text-sm text-muted-foreground">
          Please sign in, or register again, and we&rsquo;ll send a fresh
          verification message.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Check your inbox"
      subtitle={`We sent a verification message to ${email}.`}
      footer={
        <>
          Wrong email?{" "}
          <Link href="/register" className="text-primary-400 hover:underline">
            Start over
          </Link>
        </>
      }
    >
      <VerifyEmailPanel email={email} />
    </AuthCard>
  );
}
