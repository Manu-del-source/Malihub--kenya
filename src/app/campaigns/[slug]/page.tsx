import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { Container } from "@/components/ui/container";
import { formatKes } from "@/utils";
import { getPublicCampaignBySlug } from "@/services/campaign-service";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

function dateRange(start: Date, end: Date) {
  const format = (date: Date) => date.toLocaleDateString("en-KE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
  return `${format(start)} – ${format(end)}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await getPublicCampaignBySlug(slug);
  if (!campaign) return { title: "Campaign unavailable — MaliHub Kenya" };
  return {
    title: `${campaign.title} — MaliHub Kenya`,
    description: campaign.description ?? `Browse active listings in ${campaign.title} on MaliHub Kenya.`,
  };
}

export default async function CampaignDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const campaign = await getPublicCampaignBySlug(slug);
  if (!campaign) notFound();

  return (
    <Container className="flex flex-col gap-8 py-10">
      <Link href="/campaigns" className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All campaigns
      </Link>
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Featured collection</p>
        <h1 className="mt-3 font-display text-4xl font-medium">{campaign.title}</h1>
        {campaign.description ? <p className="mt-3 text-sm leading-7 text-muted-foreground">{campaign.description}</p> : null}
        <p className="mt-4 text-xs text-muted-foreground">{dateRange(campaign.startsAt, campaign.endsAt)}</p>
        <p className="mt-2 text-xs text-muted-foreground">Prices shown are the normal listing prices; this collection does not apply discounts.</p>
      </header>

      <section aria-label={`${campaign.title} listings`} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {campaign.products.map(({ product }) => {
          const imageUrl = product.images[0]?.url;
          return (
            <Link key={product.id} href={`/products/${product.slug}`} className="group overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/40">
              <div className="relative aspect-[4/3] bg-muted/40">
                {imageUrl ? (
                  <Image src={imageUrl} alt={product.title} fill sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw" unoptimized className="object-cover transition duration-300 group-hover:scale-[1.02]" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image available</div>
                )}
              </div>
              <div className="p-4">
                <h2 className="line-clamp-2 font-medium">{product.title}</h2>
                <p className="mt-2 font-display text-lg font-medium">{formatKes(product.priceCents)}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" aria-hidden /> {product.county}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{product.seller.businessName}</p>
              </div>
            </Link>
          );
        })}
      </section>
    </Container>
  );
}
