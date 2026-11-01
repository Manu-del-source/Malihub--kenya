"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, Mail } from "lucide-react";
import { resendAdminSellerInvitationAction } from "@/app/(dashboard)/admin/actions";

export function ResendSellerInvitationButton({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [activationUrl, setActivationUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function resend() {
    setMessage(null);
    setActivationUrl(null);
    setCopied(false);
    startTransition(async () => {
      const result = await resendAdminSellerInvitationAction({ email });
      if (!result.success) {
        setMessage(result.error);
        return;
      }
      if (result.data.method === "invitation" && result.data.activationUrl) {
        setActivationUrl(result.data.activationUrl);
        setMessage("A new one-time invitation was generated. The previous link is now invalid.");
      } else if (result.data.method === "verification-link") {
        setMessage(`A verification link was sent to ${email}.`);
      } else {
        setMessage(`A verification code was sent to ${email}. Ask the seller to open /verify-email?email=${encodeURIComponent(email)} and enter the code.`);
      }
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
        {pending ? "Generating…" : "Generate / resend invitation"}
      </button>
      {message && <p role="status" className="mt-2 text-xs text-muted-foreground">{message}</p>}
      {activationUrl && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <input
            aria-label="New seller invitation link"
            readOnly
            value={activationUrl}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(activationUrl);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className="mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy new link"}
          </button>
        </div>
      )}
    </div>
  );
}
