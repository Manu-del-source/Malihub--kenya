import Link from "next/link";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { listPublicActiveCampaigns } from "@/services/campaign-admin-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Campaigns | MaliHub",
  description: "Discover current MaliHub shopping campaigns and featured listings.",
  alternates: { canonical: "/campaigns" },
};

export default async function CampaignsPage() {
  const campaigns = await listPublicActiveCampaigns();

  return (
    <main className="min-h-svh bg-[#0A0A0A]">
      <Container className="py-10">
        <header className="mb-8">
          <p className="text-sm font-medium text-primary">MaliHub Marketplace</p>
          <h1 className="mt-2 font-display text-3xl font-semibold">Current campaigns</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Explore curated collections of active listings from verified sellers. Campaigns do not imply a discount unless a product price explicitly shows one.</p>
        </header>
        {campaigns.length === 0 ? (
          <section className="rounded-xl border border-border bg-card p-8">
            <h2 className="font-medium">No active campaigns right now</h2>
            <p className="mt-2 text-sm text-muted-foreground">Browse the marketplace to discover available listings.</p>
            <Link href="/marketplace" className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Browse marketplace</Link>
          </section>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {campaigns.map(campaign => (
              <article key={campaign.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="border-b border-border bg-gradient-to-br from-primary/15 via-card to-card p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">Active campaign</p>
                  <h2 className="mt-2 font-display text-xl font-semibold">{campaign.title}</h2>
                  {campaign.description && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{campaign.description}</p>}
                </div>
                <div className="space-y-2 p-5">
                  <p className="text-sm text-muted-foreground">{campaign.products.length} eligible listing{campaign.products.length === 1 ? "" : "s"}</p>
                  <div className="flex flex-wrap gap-2">
                    {campaign.products.slice(0, 3).map(({ product }) => (
                      <span key={product.id} className="rounded-full border border-border px-2.5 py-1 text-xs">{product.title}</span>
                    ))}
                    {campaign.products.length > 3 && <span className="rounded-full border border-border px-2.5 py-1 text-xs">+{campaign.products.length - 3} more</span>}
                  </div>
                  <Link href={`/campaigns/${campaign.slug}`} className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Explore campaign</Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
