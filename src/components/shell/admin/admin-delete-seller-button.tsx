"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteAdminSellerAction } from "@/app/(dashboard)/admin/actions";

export function AdminDeleteSellerButton({ sellerId, businessName }: { sellerId: string; businessName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const remove = () => startTransition(async () => {
    const result = await deleteAdminSellerAction({ sellerId });
    if (!result.success) { toast.error(result.error ?? "Could not delete seller profile."); setConfirming(false); return; }
    toast.success("Seller profile deleted."); router.refresh();
  });
  return confirming ? <span className="flex shrink-0 items-center gap-1" onClick={(event) => event.preventDefault()}>
    <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={remove}>{pending ? "Deleting…" : "Confirm"}</Button>
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
  </span> : <Button type="button" size="icon" variant="ghost" aria-label={"Delete " + businessName} title="Delete seller profile" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConfirming(true); }} className="shrink-0 text-destructive"><Trash2 className="h-4 w-4" aria-hidden /></Button>;
}
