"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Store,
  Tags,
  ShoppingCart,
  FolderTree,
  ScrollText,
} from "lucide-react";
import { cn } from "@/utils";

/**
 * Admin section navigation.
 *
 * Presentation only — hiding a tab grants nothing. Every destination below
 * re-checks `requireAdministrator()` server-side on every request, and every
 * mutation re-checks `requireAdministratorAction()`.
 *
 * Horizontally scrollable on small screens (same pattern as the dashboard's
 * mobile nav) so the admin area stays usable on a phone.
 */
const ADMIN_SECTIONS = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Sellers", href: "/admin/sellers", icon: Store },
  { label: "Listings", href: "/admin/listings", icon: Tags },
  { label: "Orders", href: "/admin/orders", icon: ShoppingCart },
  { label: "Categories", href: "/admin/categories", icon: FolderTree },
  { label: "Audit", href: "/admin/audit", icon: ScrollText },
];

export function AdminSectionNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
      className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {ADMIN_SECTIONS.map(({ label, href, icon: Icon }) => {
        const active =
          href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors",
              active
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
