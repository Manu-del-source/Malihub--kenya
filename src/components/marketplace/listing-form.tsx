"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight, Save } from "lucide-react";
import { listingSchema, type ListingInput } from "@/lib/validations/listing";
import { createListingAction, updateListingAction } from "@/app/(dashboard)/seller/listings/actions";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ImageUploadGrid } from "@/components/marketplace/image-upload-grid";
import { DEFAULT_CATEGORIES, KENYA_COUNTIES, PRODUCT_CONDITIONS } from "@/lib/constants";
import { cn } from "@/utils";

const CONTACT_OPTIONS = [
  { value: "ANY", label: "Any method" },
  { value: "CALL", label: "Phone call" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "CHAT", label: "In-app chat" },
] as const;

const selectClass =
  "h-11 w-full rounded-xl border border-border bg-background/60 px-4 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ListingForm({
  productId,
  defaultValues,
}: {
  productId?: string;
  defaultValues?: Partial<ListingInput>;
}) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ListingInput>({
    resolver: zodResolver(listingSchema),
    defaultValues: {
      isNegotiable: false,
      quantity: 1,
      contactPreference: "ANY",
      images: [],
      status: "DRAFT",
      ...defaultValues,
    },
  });

  const images = watch("images");
  const isNegotiable = watch("isNegotiable");

  async function submit(status: ListingInput["status"], input: ListingInput) {
    const payload = { ...input, status };
    const result = productId
      ? await updateListingAction(productId, payload)
      : await createListingAction(payload);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(status === "ACTIVE" ? "Listing published!" : "Draft saved.");
    router.push("/dashboard/seller/listings");
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-6">
      <FormField id="images" label="Photos" error={errors.images?.message}>
        <ImageUploadGrid images={images} onChange={(imgs) => setValue("images", imgs, { shouldValidate: true })} />
      </FormField>

      <FormField id="title" label="Title" error={errors.title?.message}>
        <Input
          id="title"
          placeholder="e.g. Toyota Probox 2015, well maintained"
          invalid={!!errors.title}
          {...register("title")}
        />
      </FormField>

      <FormField id="description" label="Description" error={errors.description?.message}>
        <textarea
          id="description"
          rows={5}
          placeholder="Describe the item's condition, features, and anything a buyer should know…"
          className={cn(
            "w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            errors.description && "border-destructive"
          )}
          {...register("description")}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField id="categorySlug" label="Category" error={errors.categorySlug?.message}>
          <select id="categorySlug" className={selectClass} defaultValue="" {...register("categorySlug")}>
            <option value="" disabled>
              Select a category
            </option>
            {DEFAULT_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="condition" label="Condition" error={errors.condition?.message}>
          <select id="condition" className={selectClass} defaultValue="" {...register("condition")}>
            <option value="" disabled>
              Select condition
            </option>
            {PRODUCT_CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField id="brand" label="Brand (optional)" error={errors.brand?.message}>
          <Input id="brand" placeholder="e.g. Toyota, Samsung" {...register("brand")} />
        </FormField>
        <FormField id="quantity" label="Quantity" error={errors.quantity?.message}>
          <Input id="quantity" type="number" min={1} {...register("quantity")} />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField id="priceCents" label="Price (KSh)" error={errors.priceCents?.message}>
          <Controller
            name="priceCents"
            control={control}
            render={({ field }) => (
              <Input
                id="priceCents"
                type="number"
                min={1}
                placeholder="e.g. 850000"
                invalid={!!errors.priceCents}
                value={field.value ? field.value / 100 : ""}
                onChange={(e) => field.onChange(Math.round(Number(e.target.value) * 100))}
              />
            )}
          />
        </FormField>

        <div className="flex items-end pb-2.5">
          <label className="flex items-center gap-2.5 text-sm text-foreground/90">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border accent-primary-500"
              checked={isNegotiable}
              onChange={(e) => setValue("isNegotiable", e.target.checked)}
            />
            Price is negotiable
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField id="county" label="County" error={errors.county?.message}>
          <select id="county" className={selectClass} defaultValue="" {...register("county")}>
            <option value="" disabled>
              Select county
            </option>
            {KENYA_COUNTIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="town" label="Town / area" error={errors.town?.message}>
          <Input id="town" placeholder="e.g. Kilimani, CBD" invalid={!!errors.town} {...register("town")} />
        </FormField>
      </div>

      <FormField id="contactPreference" label="Preferred contact method">
        <select id="contactPreference" className={selectClass} {...register("contactPreference")}>
          {CONTACT_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </FormField>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={isSubmitting}
          onClick={handleSubmit((data) => submit("DRAFT", data))}
        >
          <Save className="h-4 w-4" aria-hidden />
          Save as draft
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={isSubmitting}
          onClick={handleSubmit((data) => submit("ACTIVE", data))}
        >
          {isSubmitting ? "Publishing…" : "Publish listing"}
          {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
    </form>
  );
}
