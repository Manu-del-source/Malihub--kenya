"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startSellingAction } from "@/app/(dashboard)/account/actions";

/**
 * "Start selling" for an onboarded buyer. Calls the account Server Action,
 * which resolves the account from the session — this component sends no ids,
 * no role, and no ownership of any kind.
 */
export function StartSellingButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await startSellingAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.alreadyEnabled
          ? "Your seller profile is already set up."
          : "You're all set to start selling."
      );
      router.push("/seller");
      router.refresh();
    });
  }

  return (
    <Button onClick={handleClick} disabled={isPending}>
      <Store className="h-4 w-4" aria-hidden />
      {isPending ? "Setting up…" : "Start selling"}
    </Button>
  );
}
