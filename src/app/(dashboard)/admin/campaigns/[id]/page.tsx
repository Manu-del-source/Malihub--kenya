import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { Container } from "@/components/ui/container";
import { CampaignDeleteButton } from "@/components/shell/admin/campaign-delete-button";
import { requireAdministrator } from "@/lib/auth";
import { campaignDateInputValue } from "@/lib/validations/campaign";
import { getAdminCampaignById, listCampaignProductOptions } from "@/services/campaign-service";
import { updateCampaignAction } from "../campaign-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit campaign — admin" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
};

const errors: Record<string, string> = {
  unauthorized: "Your admin session could not be verified.",
  invalid: "Check the campaign fields, date range, and selected products.",
  slug: "That campaign slug is already in use.",
  save: "The campaign could not be saved. Please try again.",
};

export default async function EditCampaignPage({ params, searchParams }: PageProps) {
  await requireAdministrator();
  const { id } = await params;
  const [campaign, productOptions] = await Promise.all([
    getAdminCampaignById(id),
    listCampaignProductOptions(),
  ]);
  const query: { error?: string } = searchParams ? await searchParams : {};
  if (!campaign) notFound();
  const selectedIds = new Set(campaign.products.map((item) => item.productId));
  const status = campaign.status === "ENDED" ? "SCHEDULED" : campaign.status;

  return (
    <Container className="flex flex-col gap-6 py-10">
      <Link href="/admin/campaigns" className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to campaigns
      </Link>
      <header>
        <h1 className="font-display text-3xl font-medium">Edit campaign</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The campaign duration is retained until you change the start or end date. Dates are interpreted in Kenya time.
        </p>
      </header>

      {query.error && errors[query.error] ? (
        <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errors[query.error]}
        </p>
      ) : null}

      <div className="max-w-3xl rounded-2xl border border-border bg-card p-5 sm:p-7">
        <form action={updateCampaignAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={campaign.id} />
          <label className="flex flex-col gap-1.5 text-sm">
            Campaign title
            <input name="title" required minLength={3} maxLength={120} defaultValue={campaign.title} className="rounded-lg border border-border bg-background px-3 py-2.5" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            URL slug
            <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} defaultValue={campaign.slug} className="rounded-lg border border-border bg-background px-3 py-2.5" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Description
            <textarea name="description" rows={3} maxLength={2000} defaultValue={campaign.description ?? ""} className="rounded-lg border border-border bg-background px-3 py-2.5" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              Starts on
              <input type="date" name="startDate" required defaultValue={campaignDateInputValue(campaign.startsAt)} className="rounded-lg border border-border bg-background px-3 py-2.5" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              Ends on
              <input type="date" name="endDate" required defaultValue={campaignDateInputValue(campaign.endsAt)} className="rounded-lg border border-border bg-background px-3 py-2.5" />
            </label>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            Current duration: {campaignDateInputValue(campaign.startsAt)} to {campaignDateInputValue(campaign.endsAt)}
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            Status
            <select name="status" defaultValue={status} className="rounded-lg border border-border bg-background px-3 py-2.5">
              <option value="DRAFT">Draft — hidden from buyers</option>
              <option value="SCHEDULED">Schedule for the selected dates</option>
              <option value="ACTIVE">Publish for the selected dates</option>
              <option value="CANCELLED">Cancelled — hidden from buyers</option>
            </select>
            <span className="text-xs text-muted-foreground">If dates are in the future the status becomes Scheduled; after the end date it becomes Ended.</span>
          </label>
          <fieldset className="rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-medium">Eligible listings ({productOptions.length})</legend>
            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
              {productOptions.map((product) => (
                <label key={product.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/30">
                  <input type="checkbox" name="productIds" value={product.id} defaultChecked={selectedIds.has(product.id)} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{product.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{product.seller.businessName}</span>
                  </span>
                </label>
              ))}
            </div>
            {campaign.products.some((item) => !productOptions.some((option) => option.id === item.productId)) ? (
              <p className="mt-3 text-xs text-amber-200">
                Some attached listings are no longer eligible. They are hidden from buyers and will be detached when you save.
              </p>
            ) : null}
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="submit" className="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
              Save campaign
            </button>
            <CampaignDeleteButton id={campaign.id} title={campaign.title} />
          </div>
        </form>
      </div>
    </Container>
  );
}
