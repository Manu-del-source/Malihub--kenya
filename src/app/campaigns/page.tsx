import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, Megaphone, ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { listPublicCampaigns } from "@/services/campaign-service";

export const revalidate = 60;
export const metadata: Metadata = {
  title: "Campaigns — MaliHub Kenya",
  description: "Seasonal collections of active listings from verified Kenyan sellers.",
};

function dateRange(start: Date, end: Date) {
  const format = (date: Date) => date.toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
  return `${format(start)} – ${format(end)}`;
}

export default async function CampaignsPage() {
  const campaigns = await listPublicCampaigns();

  return (
    <Container className="flex flex-col gap-8 py-10">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Discover by occasion</p>
        <h1 className="mt-3 font-display text-4xl font-medium">MaliHub campaigns</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Curated collections of active listings from verified sellers. Campaigns highlight products;
          they do not imply discounts or change the price shown on each listing.
        </p>
      </header>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Megaphone className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden />
          <h2 className="mt-4 font-display text-xl font-medium">No active campaigns right now</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Seasonal collections will appear here when they are published. You can still browse every active listing.
          </p>
          <Link href="/marketplace" className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
            Browse marketplace <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((campaign) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.slug}`} className="group rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:bg-muted/20">
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs text-primary">Featured collection</span>
                <Megaphone className="h-5 w-5 text-muted-foreground transition group-hover:text-primary" aria-hidden />
              </div>
              <h2 className="mt-5 font-display text-2xl font-medium">{campaign.title}</h2>
              {campaign.description ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{campaign.description}</p> : null}
              <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                {dateRange(campaign.startsAt, campaign.endsAt)}
              </p>
              <p className="mt-4 text-sm font-medium text-primary">{campaign.products.length} listing{campaign.products.length === 1 ? "" : "s"} · Explore collection →</p>
            </Link>
          ))}
        </div>
      )}
    </Container>
  );
}
