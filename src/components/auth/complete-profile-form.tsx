"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight, ShoppingBag, Store, Sparkles, type LucideIcon } from "lucide-react";
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

type AccountIntent = CompleteProfileInput["accountIntent"];

const INTENT_OPTIONS: { value: AccountIntent; label: string; description: string; icon: LucideIcon }[] = [
  {
    value: "BUYER",
    label: "Buyer",
    description: "I'm here to shop",
    icon: ShoppingBag,
  },
  {
    value: "SELLER",
    label: "Seller",
    description: "I want to list items",
    icon: Store,
  },
  {
    value: "BOTH",
    label: "Both",
    description: "Buy and sell",
    icon: Sparkles,
  },
];

export function CompleteProfileForm({
  userId,
  defaultFullName,
  defaultAvatarUrl,
}: {
  userId: string;
  defaultFullName?: string;
  defaultAvatarUrl?: string;
}) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    control,
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
          userId={userId}
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

      <FormField id="accountIntent" label="I want to">
        <Controller
          name="accountIntent"
          control={control}
          render={({ field }) => (
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Account type">
              {INTENT_OPTIONS.map((option) => {
                const selected = field.value === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => field.onChange(option.value)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-4 text-center transition-all duration-200",
                      selected
                        ? "border-primary/50 bg-primary/10 text-primary-400"
                        : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    )}
                  >
                    <option.icon className="h-5 w-5" aria-hidden />
                    <span className="text-xs font-medium">{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        />
      </FormField>

      <Button type="submit" size="lg" disabled={isSubmitting} className="mt-1 w-full">
        {isSubmitting ? "Saving…" : "Complete profile"}
        {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
