"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Heart,
  LayoutDashboard,
  MessageCircle,
  Package,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserRound,
} from "lucide-react";

export type DashboardNavItem = { label: string; href: string };

function NavIcon({ label }: { label: string }) {
  const className = "h-4 w-4 shrink-0";
  switch (label) {
    case "Marketplace":
    case "Seller Centre":
      return <Store className={className} aria-hidden />;
    case "Wishlist":
      return <Heart className={className} aria-hidden />;
    case "Dashboard":
      return <LayoutDashboard className={className} aria-hidden />;
    case "Products":
      return <Package className={className} aria-hidden />;
    case "Supplier catalog":
      return <Boxes className={className} aria-hidden />;
    case "Orders":
    case "My orders":
      return <ShoppingCart className={className} aria-hidden />;
    case "Sales":
      return <Package className={className} aria-hidden />;
    case "Messages":
      return <MessageCircle className={className} aria-hidden />;
    case "Profile":
      return <UserRound className={className} aria-hidden />;
    case "Admin":
      return <ShieldCheck className={className} aria-hidden />;
    default:
      return null;
  }
}

export function DashboardNavLinks({
  items,
  mobile = false,
}: {
  items: DashboardNavItem[];
  mobile?: boolean;
}) {
  const pathname = usePathname();

  return (
    <>
      {items.map((item) => {
        const routePrefix = item.label === "Products" ? "/seller/listings" : item.href;
        const active =
          pathname === item.href ||
          (item.label === "Products" && pathname.startsWith("/seller/listings")) ||
          (item.label === "Supplier catalog" &&
            (pathname.startsWith("/seller/suppliers") || pathname.startsWith("/seller/supplier-catalog"))) ||
          (item.label !== "Dashboard" &&
            item.label !== "Marketplace" &&
            routePrefix !== "/buyer/wishlist" &&
            pathname.startsWith(routePrefix + "/"));

        return (
          <Link
            key={`${item.label}-${item.href}`}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              mobile ? "border border-border" : "",
            ].join(" ")}
          >
            <NavIcon label={item.label} />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
