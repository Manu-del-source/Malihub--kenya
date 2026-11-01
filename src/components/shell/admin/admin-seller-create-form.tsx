"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Store } from "lucide-react";
import { KENYA_COUNTIES } from "@/lib/constants";
import { createAdminSellerAction } from "@/app/(dashboard)/admin/actions";

const fieldClass =
  "mt-1 block h-11 w-full rounded-xl border border-border bg-background/60 px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring";

export function AdminSellerCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    sellerId: string;
    businessName: string;
    email: string;
    activationLinkSent: boolean;
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
          {success.activationLinkSent
            ? `An activation link was sent to ${success.email}. Ask the seller to open the email, select the verification link, then use “Forgot password” on the sign-in page to set a password they control.`
            : `The account was created, but Neon Auth did not confirm that the activation email was sent. Check the Neon Auth email provider, then resend the activation link from the seller record.`}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          <Link href="/login?verified=1" className="text-primary-400 hover:underline">
            Open the sign-in page
          </Link>
          {" "}·{" "}
          <Link href="/forgot-password" className="text-primary-400 hover:underline">
            Password setup / Forgot password
          </Link>
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
          <Mail className="h-4 w-4" aria-hidden />
          Seller controls their password
        </div>
        <p className="mt-2">
          MaliHub creates the Neon Auth account with a random temporary credential that it never stores
          or reveals. The seller verifies their email, then uses Forgot password to choose their own
          password. Seller verification remains a separate admin review.
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
