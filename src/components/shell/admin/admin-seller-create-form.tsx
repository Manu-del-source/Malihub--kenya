"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Store } from "lucide-react";
import { KENYA_COUNTIES } from "@/lib/constants";
import { createAdminSellerAction } from "@/app/(dashboard)/admin/actions";

const fieldClass =
  "mt-1 block h-11 w-full rounded-xl border border-border bg-background/60 px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring";

export function AdminSellerCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState<{
    sellerId: string;
    businessName: string;
    email: string;
    activationUrl: string;
    expiresAt: string;
  } | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const payload = {
      fullName: String(formData.get("fullName") ?? ""),
      email: String(formData.get("email") ?? ""),
      businessName: String(formData.get("businessName") ?? ""),
      county: String(formData.get("county") ?? ""),
      subCounty: String(formData.get("subCounty") ?? ""),
    };

    startTransition(async () => {
      const result = await createAdminSellerAction(payload);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(result.data);
      router.refresh();
    });
  }

  if (success) {
    return (
      <section className="glass rounded-2xl p-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Store className="h-5 w-5" aria-hidden />
        </div>
        <h2 className="mt-4 font-display text-xl font-medium">Seller account created</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {success.businessName} has been added to MaliHub with an unverified seller profile.
        </p>
        <p className="mt-3 text-sm">
          Share this one-time setup link with the seller. It expires in 24 hours and is invalidated
          when you generate another invitation. The seller chooses their password, then verifies
          their email through Neon Auth before signing in.
        </p>
        <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
          <label htmlFor="seller-invitation-url" className="text-xs font-medium text-muted-foreground">
            One-time seller invitation link
          </label>
          <input
            id="seller-invitation-url"
            readOnly
            value={success.activationUrl}
            className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(success.activationUrl);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy invitation link"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Expires {new Date(success.expiresAt).toLocaleString()}.
          </p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Share the link privately. Anyone who has it can attempt to activate this seller account until
          it expires or you generate a replacement.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/admin/sellers/${success.sellerId}`}
            className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            View seller
          </Link>
          <Link
            href="/admin/sellers"
            className="inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm"
          >
            Back to sellers
          </Link>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="glass flex max-w-2xl flex-col gap-5 rounded-2xl p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium">Seller&apos;s full name</span>
          <input name="fullName" required minLength={2} maxLength={80} autoComplete="name" className={fieldClass} />
        </label>
        <label className="text-sm">
          <span className="font-medium">Email address</span>
          <input name="email" type="email" required maxLength={254} autoComplete="email" className={fieldClass} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Shop / business name</span>
          <input name="businessName" required minLength={2} maxLength={100} className={fieldClass} />
        </label>
        <label className="text-sm">
          <span className="font-medium">County</span>
          <select name="county" required defaultValue="" className={fieldClass}>
            <option value="" disabled>Select county</option>
            {KENYA_COUNTIES.map((county) => <option key={county} value={county}>{county}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">Sub-county <span className="text-muted-foreground">(optional)</span></span>
          <input name="subCounty" maxLength={100} className={fieldClass} />
        </label>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Store className="h-4 w-4" aria-hidden />
          Seller controls their password
        </div>
        <p className="mt-2">
          The Neon Auth account is created when the seller redeems this invitation and chooses a
          password. Email verification is still required. Seller business verification remains a
          separate admin review.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Store className="h-4 w-4" aria-hidden />}
          {pending ? "Creating seller…" : "Create seller account"}
        </button>
        <Link href="/admin/sellers" className="text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </Link>
      </div>
    </form>
  );
}
