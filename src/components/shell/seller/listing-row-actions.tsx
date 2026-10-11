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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: () => Promise<{ success: boolean; error?: string }>, successMessage: string) {
    setOpen(false);
    setConfirmDelete(false);
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
    <div className="relative flex items-center gap-1">
      {confirmDelete ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-destructive/40 bg-card p-3 shadow-xl">
          <p className="text-sm font-medium text-foreground">Delete this listing?</p>
          <p className="mt-1 text-xs text-muted-foreground">It will be removed from the marketplace. Order history will be kept.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={isPending} onClick={() => run(() => deleteListingAction(productId), "Listing deleted.")} className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Confirm delete</button>
            <button type="button" disabled={isPending} onClick={() => setConfirmDelete(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setOpen(false); setConfirmDelete(true); }} disabled={isPending} aria-label="Delete listing" title="Delete listing" className="flex h-8 w-8 items-center justify-center rounded-full text-destructive hover:bg-destructive/10 disabled:opacity-50">
          <Trash2 className="h-4 w-4" />
        </button>
      )}
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
              href={`/seller/listings/${productId}/edit`}
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

          </div>
        </>
      )}
    </div>
  );
}
