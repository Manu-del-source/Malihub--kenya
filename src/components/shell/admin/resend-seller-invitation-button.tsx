"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";
import { resendAdminSellerInvitationAction } from "@/app/(dashboard)/admin/actions";

export function ResendSellerInvitationButton({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function resend() {
    setMessage(null);
    startTransition(async () => {
      const result = await resendAdminSellerInvitationAction({ email });
      if (!result.success) {
        setMessage(result.error);
        return;
      }
      setMessage(
        result.data.activationLinkSent
          ? `Seller activation link sent to ${email}.`
          : "Neon Auth did not confirm activation-link delivery. Check its email provider configuration."
      );
    });
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={resend}
        disabled={pending}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Mail className="h-3.5 w-3.5" aria-hidden />}
        {pending ? "Sending…" : "Resend activation link"}
      </button>
      {message && <p role="status" className="mt-2 text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
