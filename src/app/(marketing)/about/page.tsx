import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { SUPPORT_WHATSAPP } from "@/lib/support";

export const metadata: Metadata = {
  title: "About MaliHub Kenya | MaliHub Kenya",
  description: "MaliHub Kenya is an online marketplace connecting buyers and independent sellers across Kenya. Built and run by Emmanuel Kiptoo, a full-stack developer based in Eldoret, Kenya.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <Container className="marketing-page py-16 sm:py-20">
      <article className="marketing-document mx-auto max-w-3xl rounded-3xl border border-foreground/[0.07] bg-card/75 px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:px-10 sm:py-10">
        <p className="text-sm font-medium text-primary">About</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          MaliHub Kenya
        </h1>

        <section className="mt-10 space-y-3">
          <p className="leading-7 text-foreground/80">
            MaliHub Kenya is an online marketplace connecting buyers and independent sellers across Kenya. Browse local listings, compare item details, and deal directly with sellers you can reach.
          </p>
          <p className="leading-7 text-muted-foreground">
            It&apos;s built and run by Emmanuel Kiptoo, a full-stack developer based in Eldoret, Kenya. Questions, complaints or feedback go straight to a real person:{" "}
            <a
              href="https://wa.me/254795787261?text=Hello%20MaliHub%20Kenya%2C%20I%20need%20help."
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              WhatsApp or call {SUPPORT_WHATSAPP}
            </a>
            {", or email "}
            <a
              href="mailto:support@malihubke.online?subject=MaliHub%20Support"
              className="font-medium text-primary underline underline-offset-4"
            >
              support@malihubke.online
            </a>
            . We usually respond within 24 hours.
          </p>
        </section>

        <section className="mt-10 rounded-2xl border border-border p-5 sm:p-6">
          <h2 className="text-xl font-semibold">Verified sellers, confirmed payments</h2>
          <p className="mt-2 leading-7 text-muted-foreground">
            We verify sellers before their listings go live and confirm Paystack payments, so you always know who you&apos;re dealing with.
          </p>
        </section>

        <p className="mt-10">
          <Link href="/marketplace" className="font-medium text-primary underline underline-offset-4">
            Browse listings
          </Link>
          {" "}·{" "}
          <Link href="/contact" className="font-medium text-primary underline underline-offset-4">
            Talk to us
          </Link>
        </p>
      </article>
    </Container>
  );
}
