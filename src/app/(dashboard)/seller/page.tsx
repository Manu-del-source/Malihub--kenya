import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Package, CheckCircle2, FileEdit, Tags, Eye, MessageCircle, Plus } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getSellerStats } from "@/services/listing-service";
import type { RecentInquiry } from "@/services/listing-service";
import { timeAgo } from "@/utils";

export const metadata: Metadata = { title: "Seller dashboard" };

const STAT_CARDS = [
  { key: "totalListings" as const, label: "Total listings", icon: Package },
  { key: "activeListings" as const, label: "Active", icon: Tags },
  { key: "drafts" as const, label: "Drafts", icon: FileEdit },
  { key: "sold" as const, label: "Sold", icon: CheckCircle2 },
  { key: "totalViews" as const, label: "Total views", icon: Eye },
];

export default async function SellerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const seller = await prisma.seller.findUnique({
    where: { userId: user.id },
    select: { businessName: true, verificationStatus: true },
  });
  if (!seller) redirect("/dashboard/buyer");

  const stats = await getSellerStats(user.id);

  return (
    <Container className="py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Badge variant={seller.verificationStatus === "VERIFIED" ? "verified" : "default"}>
            {seller.verificationStatus}
          </Badge>
          <h1 className="mt-2 font-display text-3xl font-medium">{seller.businessName}</h1>
        </div>
        <Button asChild>
          <Link href="/dashboard/seller/listings/new">
            <Plus className="h-4 w-4" aria-hidden />
            New listing
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {STAT_CARDS.map(({ key, label, icon: Icon }) => (
          <div key={key} className="rounded-xl border border-border bg-card p-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
              <Icon className="h-4 w-4" aria-hidden />
            </div>
            <p className="mt-3 font-mono text-2xl font-medium tabular-nums">{stats[key].toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-medium">Recent inquiries</h2>
          <Link href="/dashboard/seller/listings" className="text-sm text-primary-400 hover:underline">
            View all listings
          </Link>
        </div>

        {stats.recentInquiries.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="No inquiries yet"
            description="When buyers message you about a listing, their conversations will show up here."
          />
        ) : (
          <div className="glass flex flex-col divide-y divide-border rounded-2xl">
            {stats.recentInquiries.map((inquiry: RecentInquiry) => (
              <div key={inquiry.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {inquiry.buyer.profile?.fullName ?? "A buyer"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    About: {inquiry.product?.title ?? "a listing"}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {inquiry.lastMessageAt ? timeAgo(inquiry.lastMessageAt) : "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}
