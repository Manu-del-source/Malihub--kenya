import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Neon Auth POC",
  robots: { index: false, follow: false },
};

/**
 * Layout for the isolated Neon Managed Better Auth POC.
 *
 * Everything under `/neon-auth-test` is development-only evaluation scaffolding
 * (see docs/neon-auth-poc). It shares the app's Tailwind tokens but none of the
 * production auth components or data paths.
 */
export default function NeonAuthPocLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-xs text-amber-500">
        <strong className="font-semibold">Neon Managed Better Auth — proof of concept.</strong> Isolated from
        production: Supabase Auth remains the identity provider and nothing here touches MaliHub user
        provisioning. Not enabled on the production domain unless NEON_AUTH_POC_ENABLED=true.
      </div>
      {children}
    </main>
  );
}
