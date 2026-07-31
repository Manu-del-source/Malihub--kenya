"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil, Copy, Archive, ArchiveRestore, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteListingAction,
  archiveListingAction,
  unarchiveListingAction,
  markListingSoldAction,
  duplicateListingAction,
} from "@/app/(dashboard)/seller/listings/actions";
import type { ListingStatus } from "@/types";

export function ListingRowActions({ productId, status }: { productId: string; status: ListingStatus }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: () => Promise<{ success: boolean; error?: string }>, successMessage: string) {
    setOpen(false);
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-label="Listing actions"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="glass absolute right-0 top-full z-20 mt-1 w-44 rounded-xl p-1.5">
            <Link
              href={`/dashboard/seller/listings/${productId}/edit`}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/90 hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Edit
            </Link>
            <button
              type="button"
              onClick={() => run(() => duplicateListingAction(productId), "Listing duplicated as a draft.")}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground/90 hover:bg-muted"
            >
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              Duplicate
            </button>
            {status === "ACTIVE" && (
              <button
                type="button"
                onClick={() => run(() => markListingSoldAction(productId), "Marked as sold.")}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground/90 hover:bg-muted"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                Mark as sold
              </button>
            )}
            {status === "ARCHIVED" ? (
              <button
                type="button"
                onClick={() => run(() => unarchiveListingAction(productId), "Listing restored.")}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground/90 hover:bg-muted"
              >
                <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" />
                Restore
              </button>
            ) : (
              status !== "SOLD" && (
                <button
                  type="button"
                  onClick={() => run(() => archiveListingAction(productId), "Listing archived.")}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground/90 hover:bg-muted"
                >
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                  Archive
                </button>
              )
            )}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => run(() => deleteListingAction(productId), "Listing deleted.")}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
