import { requireAdministrator } from "@/lib/auth";
import { Container } from "@/components/ui/container";
import { AdminSectionNav } from "@/components/shell/admin/admin-section-nav";

/**
 * The gate in front of every `/admin` screen.
 *
 * `requireAdministrator()` resolves the visitor from the Neon Auth session
 * and checks the role against MaliHub's own `users.role` row — on every
 * request, with no cache to go stale — before any admin data renders. A
 * BUYER or SELLER session (however it reached this layout) is redirected away
 * by the guard; middleware has already failed closed for anything without a
 * verified session. Hiding nav links is presentation; THIS is the boundary.
 *
 * The layout renders before any page under it, so one guard covers
 * `/admin`, `/admin/users/[id]`, `/admin/audit`, and anything added later
 * under this directory. Server Actions do NOT inherit it — each one re-checks
 * independently in `src/app/(dashboard)/admin/actions.ts`.
 *
 * `force-dynamic`: this route reads the session, and a session is per-request
 * state. Required, not decorative — see the layout banners across the
 * dashboard and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdministrator();

  return (
    <div className="min-h-[60vh]">
      <div className="border-b border-border bg-muted/40">
        <Container className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-sm font-medium uppercase tracking-[0.18em] text-primary-400">
              MaliHub Admin
            </p>
            <p className="text-xs text-muted-foreground">
              {user.email} ·{" "}
              <span className="font-mono uppercase">{user.role.replace("_", " ")}</span>
            </p>
          </div>
          <AdminSectionNav />
        </Container>
      </div>
      <main>{children}</main>
    </div>
  );
}
