"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KENYA_COUNTIES } from "@/lib/constants";
import { cn } from "@/utils";
import {
  sellerApplicationSchema,
  type SellerApplicationInput,
} from "@/lib/validations/seller-onboarding";
import { submitSellerApplicationAction } from "@/app/(dashboard)/seller/onboarding/actions";

type ExistingApplication = {
  businessName: string;
  description: string | null;
  county: string;
  subCounty: string | null;
  kraPin: string | null;
  verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
};

export function SellerApplicationForm({ application }: { application: ExistingApplication }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { register, handleSubmit, formState: { errors } } = useForm<SellerApplicationInput>({
    resolver: zodResolver(sellerApplicationSchema),
    defaultValues: {
      businessName: application.businessName,
      description: application.description ?? "",
      county: KENYA_COUNTIES.includes(application.county as (typeof KENYA_COUNTIES)[number])
        ? (application.county as (typeof KENYA_COUNTIES)[number])
        : undefined,
      subCounty: application.subCounty ?? "",
      kraPin: application.kraPin ?? "",
    },
  });

  function onSubmit(input: SellerApplicationInput) {
    startTransition(async () => {
      const result = await submitSellerApplicationAction(input);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Application submitted. MaliHub will review your details.");
      router.refresh();
    });
  }

  if (application.verificationStatus === "VERIFIED") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">Your seller account is verified</p>
          <p className="mt-1 text-sm">You can manage your products from the seller dashboard.</p>
          <Button className="mt-3" onClick={() => router.push("/seller")}>Go to seller dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {application.verificationStatus === "PENDING" && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Application submitted for review</p>
            <p className="mt-1 text-sm">You can update the details below and resubmit. Each submission returns the application to the review queue.</p>
          </div>
        </div>
      )}
      {application.verificationStatus === "REJECTED" && (
        <div role="status" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Your previous application was not approved. Correct your details and submit it again for review.
        </div>
      )}

      <FormField id="businessName" label="Store or business name" error={errors.businessName?.message}>
        <Input id="businessName" autoComplete="organization" placeholder="e.g. Kiptoo Electronics" invalid={!!errors.businessName} {...register("businessName")} />
      </FormField>

      <FormField id="description" label="Tell buyers about your business" error={errors.description?.message}>
        <textarea
          id="description"
          rows={5}
          maxLength={1200}
          placeholder="What do you sell? What makes your shop trustworthy? Mention your products and services."
          className={cn(
            "w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
            errors.description && "border-destructive"
          )}
          {...register("description")}
        />
        <p className="text-xs text-muted-foreground">30–1,200 characters. Do not include passwords or private identity-document links.</p>
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="county" label="Business county" error={errors.county?.message}>
          <select
            id="county"
            className={cn(
              "h-11 w-full rounded-xl border border-border bg-background/60 px-4 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              errors.county && "border-destructive"
            )}
            {...register("county")}
          >
            <option value="">Select county</option>
            {KENYA_COUNTIES.map((county) => <option key={county} value={county}>{county}</option>)}
          </select>
        </FormField>
        <FormField id="subCounty" label="Town / sub-county (optional)" error={errors.subCounty?.message}>
          <Input id="subCounty" placeholder="e.g. Eldoret" invalid={!!errors.subCounty} {...register("subCounty")} />
        </FormField>
      </div>

      <FormField id="kraPin" label="KRA PIN (optional, where applicable)" error={errors.kraPin?.message}>
        <Input id="kraPin" autoComplete="off" placeholder="Enter your business or personal KRA PIN" invalid={!!errors.kraPin} {...register("kraPin")} />
        <p className="text-xs text-muted-foreground">Only submit details you are comfortable sharing with MaliHub for seller review.</p>
      </FormField>

      <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Submitting sends your business profile to MaliHub for review. Do not upload ID cards or share identity-document links here; secure document verification will be added through private storage.
      </div>

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending ? "Submitting…" : application.verificationStatus === "PENDING" ? "Update and resubmit" : "Submit seller application"}
        {!isPending && <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
