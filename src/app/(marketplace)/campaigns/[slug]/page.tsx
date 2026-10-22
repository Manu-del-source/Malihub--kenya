import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { getPublicActiveCampaignBySlug } from "@/services/campaign-admin-service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await getPublicActiveCampaignBySlug(slug);
  if (!campaign) return { title: "Campaign not found | MaliHub" };
  return {
    title: `${campaign.title} | MaliHub Campaigns`,
    description: campaign.description ?? `Explore listings in the ${campaign.title} campaign on MaliHub.`,
    alternates: { canonical: `/campaigns/${campaign.slug}` },
  };
}

export default async function CampaignDetailPage({ params }: Props) {
  const { slug } = await params;
  const campaign = await getPublicActiveCampaignBySlug(slug);
  if (!campaign) notFound();

  return (
    <main className="min-h-svh bg-[#0A0A0A]">
      <Container className="py-10">
        <Link href="/campaigns" className="text-sm text-primary hover:underline">← All campaigns</Link>
        <header className="my-6 rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-card to-card p-6 sm:p-9">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Active campaign</p>
          <h1 className="mt-2 font-display text-3xl font-semibold">{campaign.title}</h1>
          {campaign.description && <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{campaign.description}</p>}
          <p className="mt-4 text-xs text-muted-foreground">Available until {campaign.endsAt.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" })} EAT</p>
        </header>
        {campaign.products.length === 0 ? (
          <section className="rounded-xl border border-border p-8">
            <h2 className="font-medium">No eligible listings remain in this campaign</h2>
            <Link href="/marketplace" className="mt-3 inline-block text-sm text-primary hover:underline">Browse all listings</Link>
          </section>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {campaign.products.map(({ product }) => (
              <article key={product.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <Link href={`/products/${product.slug}`} className="block p-3 sm:p-4">
                  <div className="relative mb-3 flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-xs text-muted-foreground">
                    {product.images[0]?.url ? <Image src={product.images[0].url} alt={product.title} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw" className="object-cover" /> : "Product listing"}
                  </div>
                  <h2 className="line-clamp-2 min-h-10 text-sm font-medium">{product.title}</h2>
                  <p className="mt-2 font-semibold text-primary">KES {(product.priceCents / 100).toLocaleString("en-KE")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{product.county}</p>
                </Link>
              </article>
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
