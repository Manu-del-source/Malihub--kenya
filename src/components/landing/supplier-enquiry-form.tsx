"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const inputClass = "mt-2 w-full rounded-xl border border-foreground/10 bg-black/30 px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60";
const labelClass = "block text-sm font-medium text-foreground/80";

export function SupplierEnquiryForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [categories, setCategories] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true); setError(""); setSuccess("");
    const form = new FormData(formElement);
    const payload = {
      companyName: String(form.get("companyName") ?? ""),
      contactName: String(form.get("contactName") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      location: String(form.get("location") ?? ""),
      categories: categories.split(",").map((v) => v.trim()).filter(Boolean),
      catalogueUrl: String(form.get("catalogueUrl") ?? ""),
      websiteUrl: String(form.get("websiteUrl") ?? ""),
      message: String(form.get("message") ?? ""),
      consent: form.get("consent") === "on",
      companyWebsite: String(form.get("companyWebsite") ?? ""),
    };
    try {
      const response = await fetch("/api/supplier-enquiries", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to submit your enquiry.");
      setSuccess(result.message);
      setCategories("");
      formElement.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit your enquiry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-foreground/10 bg-card p-5 sm:p-7">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={labelClass}>Business name *
          <input name="companyName" required minLength={2} maxLength={160} className={inputClass} autoComplete="organization" />
        </label>
        <label className={labelClass}>Contact person *
          <input name="contactName" required minLength={2} maxLength={120} className={inputClass} autoComplete="name" />
        </label>
        <label className={labelClass}>Business email *
          <input name="email" type="email" required maxLength={254} className={inputClass} autoComplete="email" />
        </label>
        <label className={labelClass}>Phone / WhatsApp *
          <input name="phone" type="tel" required minLength={7} maxLength={40} className={inputClass} autoComplete="tel" />
        </label>
        <label className={labelClass}>Business location
          <input name="location" maxLength={120} placeholder="Town / County" className={inputClass} />
        </label>
        <label className={labelClass}>Product categories *
          <input value={categories} onChange={(e) => setCategories(e.target.value)} required placeholder="Fashion, electronics, home..." className={inputClass} />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">Separate categories with commas.</span>
        </label>
        <label className={labelClass}>Catalogue link
          <input name="catalogueUrl" type="url" placeholder="https://" className={inputClass} />
        </label>
        <label className={labelClass}>Business website
          <input name="websiteUrl" type="url" placeholder="https://" className={inputClass} />
        </label>
      </div>
      <label className={labelClass + " mt-5"}>Anything else we should know?
        <textarea name="message" rows={4} maxLength={2000} className={inputClass} placeholder="Tell us about your catalogue, stock availability or supply capacity." />
      </label>
      <label className="mt-5 flex items-start gap-3 text-xs leading-5 text-muted-foreground"><input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-[#B8934A]" /> I agree that MaliHub may use these details to assess this supplier enquiry and contact me about a potential partnership.</label>
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label>Leave this field empty<input name="companyWebsite" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      {success && <p role="status" className="mt-4 flex items-start gap-2 text-sm text-emerald-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{success}</p>}
      <Button type="submit" size="lg" disabled={busy} className="mt-6 w-full sm:w-auto">
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</> : <>Submit supplier enquiry <ArrowRight className="h-4 w-4" /></>}
      </Button>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Your details are used to assess this supplier enquiry. Submission does not create an account or guarantee approval or orders.</p>
    </form>
  );
}
