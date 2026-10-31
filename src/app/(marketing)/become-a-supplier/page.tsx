import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgeCheck, Boxes, ClipboardCheck, PackageCheck } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { SupplierEnquiryForm } from "@/components/landing/supplier-enquiry-form";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Become a Supplier | MaliHub Kenya",
  description: "Partner with MaliHub Kenya to make your wholesale catalogue available to customers and independent online sellers.",
  alternates: { canonical: "/become-a-supplier" },
};

const steps = [
  { icon: ClipboardCheck, title: "Tell us about your business", text: "Share your business name, product categories, location and the best person to contact." },
  { icon: BadgeCheck, title: "We review the partnership", text: "Our team discusses business verification, catalogue rights, wholesale prices, stock updates and commercial terms with you." },
  { icon: Boxes, title: "Agree the catalogue and prices", text: "You provide product details, images you are authorised to share, wholesale costs and stock information. We review products before they are made available." },
  { icon: PackageCheck, title: "Prepare orders when confirmed", text: "You confirm availability and prepare accepted orders for handover under the agreed fulfilment process." },
];

const requirements = [
  "A verifiable business and a named contact person",
  "A product catalogue with accurate descriptions and images you are authorised to use",
  "Wholesale prices and a process for notifying MaliHub about price or stock changes",
  "Clear order preparation, dispatch, returns and warranty terms",
  "Agreement on courier arrangements and delivery charges before orders go live",
];

export default function BecomeSupplierPage() {
  return (
    <div className="min-h-screen bg-background pb-20 pt-32 sm:pt-36">
      <Container>
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary-400">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to MaliHub
        </Link>

        <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-[radial-gradient(ellipse_at_top_right,rgba(184,147,74,0.16),transparent_48%),#10100f] px-6 py-12 sm:px-10 sm:py-16 lg:px-16">
          <div className="max-w-3xl">
            <Badge variant="primary">MaliHub supplier partnerships</Badge>
            <h1 className="mt-6 text-balance font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Bring your catalogue to a wider marketplace.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
              We are inviting Kenyan wholesalers, manufacturers, importers and distributors to explore supplying products through MaliHub. You provide the products and fulfilment capability; MaliHub provides the marketplace channel.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild><a href="#supplier-enquiry">Discuss a supplier partnership <ArrowRight className="h-4 w-4" aria-hidden /></a></Button>
              <Button size="lg" variant="secondary" asChild><Link href="/marketplace">Explore the marketplace</Link></Button>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Submitting an enquiry does not create an account or guarantee approval or orders. Supplier onboarding is handled manually after verification and agreement on commercial terms.
            </p>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-400">How it works</p>
            <h2 className="mt-3 font-display text-3xl font-medium sm:text-4xl">A straightforward supplier relationship.</h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">You remain the supplier. MaliHub does not buy or warehouse your stock, and does not operate its own delivery fleet.</p>
          </div>
          <div className="mt-9 grid gap-4 sm:grid-cols-2">
            {steps.map(({ icon: Icon, title, text }, index) => (
              <article key={title} className="rounded-2xl border border-foreground/[0.08] bg-card p-6">
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary-400"><Icon className="h-5 w-5" aria-hidden /></span>
                  <span className="text-xs font-medium tracking-widest text-muted-foreground">0{index + 1}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-10 border-t border-foreground/[0.08] py-16 sm:py-20 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-400">What we need</p>
            <h2 className="mt-3 font-display text-3xl font-medium sm:text-4xl">Come prepared to supply reliably.</h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">These details help us assess whether the partnership is suitable and set clear expectations before products are published.</p>
          </div>
          <ul className="space-y-4">
            {requirements.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-400" aria-hidden /> {item}
              </li>
            ))}
          </ul>
        </section>

        <section id="supplier-enquiry" className="scroll-mt-28 border-t border-foreground/[0.08] py-16 sm:py-20">
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-400">Supplier application</p>
            <h2 className="mt-3 font-display text-3xl font-medium sm:text-4xl">Tell us about your business.</h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">Your enquiry goes directly into MaliHub’s private supplier recruitment queue. Our team will contact you to verify the business, discuss wholesale pricing and agree how orders and courier delivery will be handled.</p>
          </div>
          <SupplierEnquiryForm />
        </section>
      </Container>
    </div>
  );
}
