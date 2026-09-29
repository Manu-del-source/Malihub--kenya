import Link from "next/link";
import type { Metadata } from "next";
import { Search, Users } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { AdminPagination, adminListHref } from "@/components/shell/admin/admin-pagination";
import { AccountStatusBadge, SellerVerificationBadge, UserRoleBadge } from "@/components/shell/admin/admin-badges";
import { formatDate } from "@/components/shell/admin/admin-format";
import { requireAdministrator } from "@/lib/auth";
import { listAdminUsers } from "@/services/admin-service";
import { adminUserListSchema, parseListParams, type RawSearchParams } from "@/lib/validations/admin";

/**
 * `/admin/users` — search, role/status filtering, and pagination over the
 * accounts table. Server component: the query runs in Prisma with the
 * validated params only, and the rows never include anything
 * credential-shaped — `users` holds no passwords (Neon Auth does) and the
 * provider mapping column is selected out of the query entirely.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Users — admin" };

const ROLE_OPTIONS = ["BUYER", "SELLER", "ADMIN", "SUPER_ADMIN"] as const;
const ACCOUNT_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Deactivated" },
  { value: "banned", label: "Banned" },
] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdministrator();

  const parsed = parseListParams(adminUserListSchema, await searchParams);
  const filters = parsed ?? { page: 1 };

  const { users, total, pageSize } = await listAdminUsers(filters);
  const current = {
    q: filters.q ?? "",
    role: filters.role ?? "",
    account: filters.account ?? "",
  };

  return (
    <Container className="flex flex-col gap-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} account{total === 1 ? "" : "s"} matching the current filters
          </p>
        </div>
      </header>

      {/* Filters are a plain GET form — no client JS, and every value goes
          through the server-side zod schema before it can affect the query. */}
      <form className="glass-sm flex flex-wrap items-end gap-3 rounded-2xl p-4" method="GET">
        <label className="text-sm">
          <span className="text-muted-foreground">Search</span>
          <Input
            type="search"
            name="q"
            defaultValue={current.q}
            maxLength={120}
            placeholder="Name or email"
            className="mt-1 w-64"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Role</span>
          <Select name="role" value={current.role} options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === "SUPER_ADMIN" ? "SUPER ADMIN" : r }))} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Account status</span>
          <Select name="account" value={current.account} options={[...ACCOUNT_OPTIONS]} />
        </label>
        <Button type="submit" size="sm">
          <Search className="h-4 w-4" aria-hidden />
          Apply
        </Button>
        {(current.q || current.role || current.account) && (
          <Link href="/admin/users" className="self-center text-xs text-muted-foreground underline-offset-4 hover:underline">
            Clear filters
          </Link>
        )}
      </form>

      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          title={total === 0 && !current.q && !current.role && !current.account ? "No accounts yet." : "Nothing matches these filters."}
          description={
            current.q || current.role || current.account
              ? "Try a broader search or clear the filters."
              : "User rows are provisioned when someone signs in for the first time."
          }
        />
      ) : (
        <div className="glass flex flex-col divide-y divide-border rounded-2xl">
          {users.map((user) => (
            <Link
              key={user.id}
              href={`/admin/users/${user.id}`}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary-400"
              >
                {(user.profile?.fullName ?? user.email).charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {user.profile?.fullName ?? "Unnamed account"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                  {user.profile?.county ? ` · ${user.profile.county}` : ""}
                </span>
              </span>
              <span className="hidden shrink-0 items-center gap-2 sm:flex">
                {user.seller && <SellerVerificationBadge status={user.seller.verificationStatus} />}
                <UserRoleBadge role={user.role} />
                <AccountStatusBadge isActive={user.isActive} isBanned={user.isBanned} />
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                <span className="block font-mono tabular-nums text-foreground/80">
                  {user._count.products}L · {user._count.orders}O
                </span>
                Joined {formatDate(user.createdAt)}
              </span>
            </Link>
          ))}
        </div>
      )}

      <AdminPagination
        page={filters.page}
        pageSize={pageSize}
        total={total}
        label="accounts"
        buildHref={(page) => adminListHref("/admin/users", current, page)}
      />
    </Container>
  );
}

function Select({
  name,
  value,
  options,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      name={name}
      defaultValue={value}
      className="mt-1 block h-11 w-44 rounded-xl border border-border bg-background/60 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value="">All</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
