import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { SUPPORT_WHATSAPP, SUPPORT_WHATSAPP_NUMBER_PUBLIC } from "@/lib/support";

export const metadata: Metadata = {
  title: "Contact Us | MaliHub Kenya",
  description: "Talk to MaliHub Kenya on WhatsApp, by email, or on Instagram. We usually respond within 24 hours.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <Container className="marketing-page py-16 sm:py-20">
      <article className="marketing-document mx-auto max-w-3xl rounded-3xl border border-foreground/[0.07] bg-card/75 px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:px-10 sm:py-10">
        <p className="text-sm font-medium text-primary">Contact</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Talk to us.
        </h1>

        <section className="mt-10 space-y-3">
          <p className="leading-7 text-foreground/80">
            <strong>WhatsApp or call:</strong>{" "}
            <a
              href={`https://wa.me/${SUPPORT_WHATSAPP_NUMBER_PUBLIC}?text=${encodeURIComponent("Hello MaliHub Kenya, I need help.")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              {SUPPORT_WHATSAPP}
            </a>{" "}
            (fastest)
          </p>
          <p className="leading-7 text-foreground/80">
            <strong>Email:</strong>{" "}
            <a
              href="mailto:support@malihubke.online?subject=MaliHub%20Support"
              className="font-medium text-primary underline underline-offset-4"
            >
              support@malihubke.online
            </a>
          </p>
          <p className="leading-7 text-foreground/80">
            <strong>Instagram:</strong>{" "}
            <a
              href="https://www.instagram.com/malihubke/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              @malihubke
            </a>
          </p>
          <p className="leading-7 text-muted-foreground">
            We usually respond{" "}
            <strong>within 24 hours, and usually much faster</strong>. Please never send passwords, M-Pesa PINs, or verification codes.
          </p>
        </section>

        <section className="mt-10 rounded-2xl border border-border p-5 sm:p-6">
          <h2 className="text-xl font-semibold">For disputes about a purchase</h2>
          <p className="mt-2 leading-7 text-muted-foreground">
            For disputes about a purchase, include the listing link and your payment confirmation and we&apos;ll take it up with the seller.
          </p>
        </section>

        <p className="mt-10">
          <Link href="/support" className="font-medium text-primary underline underline-offset-4">
            Support &amp; safety
          </Link>
          {" "}·{" "}
          <Link href="/about" className="font-medium text-primary underline underline-offset-4">
            About MaliHub Kenya
          </Link>
        </p>
      </article>
    </Container>
  );
}
