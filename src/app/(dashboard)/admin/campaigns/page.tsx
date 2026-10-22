import Link from "next/link";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { requireAdministrator } from "@/lib/auth";
import { listAdminCampaigns } from "@/services/campaign-admin-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns | Admin" };

function campaignTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ACTIVE") return "default";
  if (status === "CANCELLED") return "destructive";
  if (status === "SCHEDULED") return "secondary";
  return "outline";
}

export default async function AdminCampaignsPage() {
  await requireAdministrator();
  const campaigns = await listAdminCampaigns();

  return (
    <Container className="flex flex-col gap-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/admin" className="hover:underline">Admin</Link> / Merchandising</p>
          <h1 className="mt-2 font-display text-3xl font-medium">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review campaign schedules and the real listings assigned to each campaign.</p>
        </div>
        <Link href="/admin" className="text-sm text-primary-400 hover:underline">Back to overview</Link>
      </header>

      {campaigns.length === 0 ? (
        <section className="rounded-xl border border-border p-8">
          <h2 className="font-medium">No campaigns yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Campaign records will appear here after they are created through the campaign administration workflow.</p>
        </section>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Products</th>
                <th className="px-4 py-3 font-medium">Starts</th>
                <th className="px-4 py-3 font-medium">Ends</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{campaign.title}</p>
                    <p className="text-xs text-muted-foreground">/{campaign.slug}</p>
                  </td>
                  <td className="px-4 py-3"><Badge variant={campaignTone(campaign.status)}>{campaign.status}</Badge></td>
                  <td className="px-4 py-3 tabular-nums">{campaign._count.products}</td>
                  <td className="px-4 py-3">{campaign.startsAt.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" })}</td>
                  <td className="px-4 py-3">{campaign.endsAt.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Container>
  );
}
