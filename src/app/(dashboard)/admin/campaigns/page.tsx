import Link from "next/link";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { requireAdministrator } from "@/lib/auth";
import { listAdminCampaigns, listEligibleCampaignProducts } from "@/services/campaign-admin-service";
import { CampaignManagement } from "./campaign-management";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns | Admin" };

function campaignTone(status: string): "default" | "primary" | "cyan" | "glass" | "verified" {
  if (status === "ACTIVE") return "verified";
  if (status === "CANCELLED") return "primary";
  if (status === "SCHEDULED") return "cyan";
  return "default";
}

export default async function AdminCampaignsPage() {
  await requireAdministrator();
  const [campaigns, products] = await Promise.all([listAdminCampaigns(), listEligibleCampaignProducts()]);

  return (
    <Container className="flex flex-col gap-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/admin" className="hover:underline">Admin</Link> / Merchandising</p>
          <h1 className="mt-2 font-display text-3xl font-medium">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create campaigns, assign eligible listings, and manage scheduling.</p>
        </div>
        <Link href="/admin" className="text-sm text-primary-400 hover:underline">Back to overview</Link>
      </header>

      <CampaignManagement products={products} campaigns={campaigns.map(c => ({ id: c.id, title: c.title, slug: c.slug, description: c.description, startsAt: c.startsAt.toISOString(), endsAt: c.endsAt.toISOString(), status: c.status, products: c.products }))} />

      <section>
        <h2 className="mb-3 text-xl font-medium">Campaign overview</h2>
        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-border p-8">
            <h3 className="font-medium">No campaigns yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">Create the first campaign using the form above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/40 text-muted-foreground"><tr>
                <th className="px-4 py-3 font-medium">Campaign</th><th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Products</th><th className="px-4 py-3 font-medium">Starts</th><th className="px-4 py-3 font-medium">Ends</th>
              </tr></thead>
              <tbody className="divide-y divide-border">{campaigns.map(campaign => (
                <tr key={campaign.id}>
                  <td className="px-4 py-3"><p className="font-medium">{campaign.title}</p><p className="text-xs text-muted-foreground">/{campaign.slug}</p></td>
                  <td className="px-4 py-3"><Badge variant={campaignTone(campaign.status)}>{campaign.status}</Badge></td>
                  <td className="px-4 py-3 tabular-nums">{campaign._count.products}</td>
                  <td className="px-4 py-3">{campaign.startsAt.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" })}</td>
                  <td className="px-4 py-3">{campaign.endsAt.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" })}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </Container>
  );
}
