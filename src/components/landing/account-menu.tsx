"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as Avatar from "@radix-ui/react-avatar";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, Store, MessageCircle, LogOut } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";

export type HeaderUser = {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  hasSellerProfile: boolean;
};

function initials(name: string | null, email: string) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || email[0]!.toUpperCase();
  }
  return email[0]!.toUpperCase();
}

export function AccountMenu({ user }: { user: HeaderUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border transition-colors hover:border-primary/40"
      >
        <Avatar.Root className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-400 to-secondary text-xs font-medium text-primary-foreground">
          {user.avatarUrl && <Avatar.Image src={user.avatarUrl} alt="" className="h-full w-full object-cover" />}
          <Avatar.Fallback>{initials(user.fullName, user.email)}</Avatar.Fallback>
        </Avatar.Root>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="glass absolute right-0 top-full mt-2 w-56 rounded-xl p-1.5"
          >
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium text-foreground">
                {user.fullName || "Your account"}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <div className="my-1 h-px bg-border" />
            <Link
              href="/dashboard/buyer"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/90 hover:bg-muted"
            >
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" aria-hidden />
              Dashboard
            </Link>
            <Link
              href="/messages"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/90 hover:bg-muted"
            >
              <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
              Messages
            </Link>
            {user.hasSellerProfile && (
              <Link
                href="/dashboard/seller"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/90 hover:bg-muted"
              >
                <Store className="h-4 w-4 text-muted-foreground" aria-hidden />
                Seller dashboard
              </Link>
            )}
            <div className="my-1 h-px bg-border" />
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Sign out
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
