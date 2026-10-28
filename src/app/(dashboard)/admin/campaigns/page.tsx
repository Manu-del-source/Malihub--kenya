import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, Megaphone, Plus } from "lucide-react";
import { Container } from "@/components/ui/container";
import { CampaignDeleteButton } from "@/components/shell/admin/campaign-delete-button";
import { requireAdministrator } from "@/lib/auth";
import { formatKes } from "@/utils";
import { listAdminCampaigns, listCampaignProductOptions } from "@/services/campaign-service";
import { createCampaignAction } from "../campaign-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns — admin" };

type PageProps = {
  searchParams?: Promise<{ notice?: string; error?: string }>;
};

const notices: Record<string, string> = {
  created: "Campaign created.",
  updated: "Campaign updated.",
  deleted: "Campaign deleted. Products and their listings were retained.",
};

const errors: Record<string, string> = {
  unauthorized: "Your admin session could not be verified.",
  invalid: "Check the campaign fields, date range, and selected products.",
  slug: "That campaign slug is already in use.",
  save: "The campaign could not be saved. Please try again.",
};

function kenyaDate(date: Date) {
  return date.toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
}

function statusClass(status: string) {
  if (status === "ACTIVE") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "SCHEDULED") return "border-blue-500/30 bg-blue-500/10 text-blue-300";
  if (status === "CANCELLED" || status === "ENDED") return "border-border bg-muted/30 text-muted-foreground";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

export default async function AdminCampaignsPage({ searchParams }: PageProps) {
  await requireAdministrator();
  const [campaigns, productOptions] = await Promise.all([
    listAdminCampaigns(),
    listCampaignProductOptions(),
  ]);
  const params: { notice?: string; error?: string } = searchParams ? await searchParams : {};

  return (
    <Container className="flex flex-col gap-8 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-medium">Merchandising campaigns</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Group verified sellers’ active listings for seasonal discovery. Campaigns do not create
            discounts or change checkout prices; all prices remain the product’s normal listing price.
          </p>
        </div>
        <Link href="/campaigns" className="rounded-full border border-border px-4 py-2 text-sm hover:border-primary/40">
          View public campaigns
        </Link>
      </header>

      {params.notice && notices[params.notice] ? (
        <p role="status" className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notices[params.notice]}
        </p>
      ) : null}
      {params.error && errors[params.error] ? (
        <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errors[params.error]}
        </p>
      ) : null}

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="rounded-xl bg-primary/10 p-2 text-primary"><Plus className="h-5 w-5" aria-hidden /></span>
            <div>
              <h2 className="font-display text-xl font-medium">Create a campaign</h2>
              <p className="text-xs text-muted-foreground">Dates use Kenya time (UTC+03:00).</p>
            </div>
          </div>

          {productOptions.length === 0 ? (
            <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-200">
              No eligible products yet. A campaign needs at least one active listing from a verified seller.
            </p>
          ) : null}

          <form action={createCampaignAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              Campaign title
              <input name="title" required minLength={3} maxLength={120} className="rounded-lg border border-border bg-background px-3 py-2.5" placeholder="Mashujaa Week Finds" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              URL slug
              <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} className="rounded-lg border border-border bg-background px-3 py-2.5" placeholder="mashujaa-week-finds" />
              <span className="text-xs text-muted-foreground">Lowercase letters, numbers and hyphens only.</span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              Description
              <textarea name="description" rows={3} maxLength={2000} className="rounded-lg border border-border bg-background px-3 py-2.5" placeholder="A seasonal collection of listings from verified Kenyan sellers." />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                Starts on
                <input type="date" name="startDate" required className="rounded-lg border border-border bg-background px-3 py-2.5" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                Ends on
                <input type="date" name="endDate" required className="rounded-lg border border-border bg-background px-3 py-2.5" />
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-sm">
              Initial status
              <select name="status" defaultValue="DRAFT" className="rounded-lg border border-border bg-background px-3 py-2.5">
                <option value="DRAFT">Draft — hidden from buyers</option>
                <option value="SCHEDULED">Schedule for the selected dates</option>
                <option value="ACTIVE">Publish for the selected dates</option>
                <option value="CANCELLED">Cancelled — hidden from buyers</option>
              </select>
              <span className="text-xs text-muted-foreground">Scheduled/active state is reconciled against the dates on save.</span>
            </label>
            <fieldset className="rounded-xl border border-border p-3">
              <legend className="px-1 text-sm font-medium">Eligible listings ({productOptions.length})</legend>
              <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                {productOptions.map((product) => (
                  <label key={product.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/30">
                    <input type="checkbox" name="productIds" value={product.id} className="mt-1" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{product.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{product.seller.businessName}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums">{formatKes(product.priceCents)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" disabled={productOptions.length === 0} className="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
              Create campaign
            </button>
          </form>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-medium">Existing campaigns</h2>
            <span className="text-sm text-muted-foreground">{campaigns.length} total</span>
          </div>
          {campaigns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <Megaphone className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="mt-3 font-medium">No campaigns created</p>
              <p className="mt-1 text-sm text-muted-foreground">Create a seasonal collection when eligible listings are available.</p>
            </div>
          ) : campaigns.map((campaign) => (
            <article key={campaign.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium">{campaign.title}</h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground">/campaigns/{campaign.slug}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs ${statusClass(campaign.status)}`}>{campaign.status}</span>
              </div>
              {campaign.description ? <p className="mt-3 text-sm text-muted-foreground">{campaign.description}</p> : null}
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                {kenyaDate(campaign.startsAt)} – {kenyaDate(campaign.endsAt)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {campaign.products.length} listing{campaign.products.length === 1 ? "" : "s"} attached
              </p>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                <Link href={`/admin/campaigns/${campaign.id}`} className="text-sm font-medium text-primary hover:underline">Edit campaign</Link>
                <CampaignDeleteButton id={campaign.id} title={campaign.title} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <p className="text-xs leading-5 text-muted-foreground">
        Deleting a campaign removes only the campaign and its product links. Product listings, seller accounts,
        order history, and their prices are retained. Every campaign mutation is recorded in the admin audit log.
      </p>
    </Container>
  );
}
