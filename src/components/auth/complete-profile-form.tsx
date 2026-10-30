"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import {
  completeProfileSchema,
  type CompleteProfileInput,
} from "@/lib/validations/auth";
import { completeProfileAction } from "@/app/(auth)/actions";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AvatarUpload } from "@/components/auth/avatar-upload";
import { KENYA_COUNTIES } from "@/lib/constants";
import { cn } from "@/utils";

export function CompleteProfileForm({
  defaultFullName,
  defaultAvatarUrl,
}: {
  defaultFullName?: string;
  defaultAvatarUrl?: string;
}) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CompleteProfileInput>({
    resolver: zodResolver(completeProfileSchema),
    defaultValues: {
      fullName: defaultFullName ?? "",
      phone: "",
      accountIntent: "BUYER",
      avatarUrl: defaultAvatarUrl ?? "",
    },
  });

  const avatarUrl = watch("avatarUrl") ?? "";

  async function onSubmit(input: CompleteProfileInput) {
    const result = await completeProfileAction(input);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Profile complete — welcome to MaliHub!");
    router.push(result.data.redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      <FormField id="avatar" label="Profile photo">
        <AvatarUpload
          value={avatarUrl}
          onChange={(url) => setValue("avatarUrl", url, { shouldValidate: true })}
        />
      </FormField>

      <FormField id="fullName" label="Full name" error={errors.fullName?.message}>
        <Input
          id="fullName"
          autoComplete="name"
          placeholder="e.g. Wanjiru Kamau"
          invalid={!!errors.fullName}
          {...register("fullName")}
        />
      </FormField>

      <FormField id="phone" label="Phone number" error={errors.phone?.message}>
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          placeholder="0712345678"
          invalid={!!errors.phone}
          {...register("phone")}
        />
      </FormField>

      <FormField id="county" label="County" error={errors.county?.message}>
        <select
          id="county"
          className={cn(
            "h-11 w-full rounded-xl border border-border bg-background/60 px-4 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            errors.county && "border-destructive"
          )}
          defaultValue=""
          {...register("county")}
        >
          <option value="" disabled>
            Select your county
          </option>
          {KENYA_COUNTIES.map((county) => (
            <option key={county} value={county}>
              {county}
            </option>
          ))}
        </select>
      </FormField>

      <Button type="submit" size="lg" disabled={isSubmitting} className="mt-1 w-full">
        {isSubmitting ? "Saving…" : "Complete profile"}
        {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
