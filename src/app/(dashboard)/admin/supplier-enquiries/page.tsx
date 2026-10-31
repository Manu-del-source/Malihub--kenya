import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { SupplierEnquiryManager } from "@/components/shell/admin/supplier-enquiry-manager";
import { requireAdministrator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Supplier enquiries — Admin" };

export default async function AdminSupplierEnquiriesPage() {
  await requireAdministrator();
  const [leads, counts] = await Promise.all([
    prisma.supplierLead.findMany({
      orderBy: [{ followUpAt: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true, companyName: true, contactName: true, email: true, phone: true,
        location: true, categories: true, catalogueUrl: true, websiteUrl: true,
        message: true, status: true, internalNotes: true, wholesaleTerms: true,
        deliveryTerms: true, followUpAt: true, createdAt: true,
      },
    }),
    prisma.supplierLead.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const total = counts.reduce((sum, item) => sum + item._count._all, 0);
  return (
    <Container className="py-10 text-foreground">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Partnership pipeline</p>
        <h1 className="mt-2 font-display text-3xl font-medium">Supplier enquiries</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Review incoming wholesalers and distributors, track follow-ups, and record negotiated wholesale and delivery terms. All notes and commercial terms on this page are admin-only.</p>
        <Link href="/admin/dropshipping" className="mt-4 inline-flex text-sm text-gold hover:underline">Open supplier registry and approval controls →</Link>
      </header>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <div className="rounded-xl border border-foreground/10 bg-card p-4"><p className="text-2xl text-gold">{total}</p><p className="text-xs text-muted-foreground">All enquiries</p></div>
        {["NEW", "CONTACTED", "QUALIFIED", "NEGOTIATING", "VERIFICATION_PENDING", "ONBOARDED", "DECLINED"].map((status) => (
          <div key={status} className="rounded-xl border border-foreground/10 bg-card p-4"><p className="text-2xl text-foreground">{counts.find((item) => item.status === status)?._count._all ?? 0}</p><p className="text-xs text-muted-foreground">{status.replaceAll("_", " ")}</p></div>
        ))}
      </div>
      {leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-foreground/15 p-10 text-center">
          <h2 className="text-lg font-medium">No supplier enquiries yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">New submissions from the Become a Supplier page will appear here.</p>
        </div>
      ) : (
        <div className="space-y-5">{leads.map((lead) => <SupplierEnquiryManager key={lead.id} lead={{ ...lead, followUpAt: lead.followUpAt?.toISOString() ?? null, createdAt: lead.createdAt.toISOString() }} />)}</div>
      )}
    </Container>
  );
}
