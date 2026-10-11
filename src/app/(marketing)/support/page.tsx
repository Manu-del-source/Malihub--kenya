import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Support & Safety | MaliHub Kenya",
  description: "Learn how to report suspicious MaliHub listings and protect yourself when buying or selling online.",
  alternates: { canonical: "/support" },
};

const tips = [
  "Check the photos, description, price, and seller information carefully before agreeing to buy.",
  "Ask the seller to confirm availability, condition, delivery or collection arrangements, and the full price.",
  "Never share your M-Pesa PIN, password, or one-time verification code. A payment screenshot is not proof that funds have arrived.",
  "Avoid listings that pressure you to pay urgently, request unusual payment arrangements, or promise something that sounds too good to be true.",
];

export default function SupportPage() {
  return (
    <Container className="py-12 sm:py-16">
      <article className="mx-auto max-w-3xl">
        <p className="text-sm font-medium text-primary">Help centre</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Support &amp; Safety
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Help us keep MaliHub a safer place to buy and sell. Report suspicious listings and take care when communicating or making payments.
        </p>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold">How to report a listing</h2>
          <ol className="list-decimal space-y-2 pl-5 leading-7 text-foreground/80">
            <li>Open the product listing you are concerned about.</li>
            <li>Select <strong>Report listing</strong> on the product details page.</li>
            <li>Choose the closest reason: suspected scam, counterfeit item, prohibited item, misleading listing, offensive content, or other.</li>
            <li>Add useful details, then submit the report. Please be factual and do not include unrelated personal information.</li>
          </ol>
          <p className="leading-7 text-muted-foreground">
            You must be signed in to submit a report. If you are not signed in, sign in first and return to the listing. A submitted report is a request for review, not a guarantee that the listing has already been checked or removed.
          </p>
          <p>
            <Link href="/marketplace" className="font-medium text-primary underline underline-offset-4">
              Browse listings
            </Link>
            {" "}·{" "}
            <Link href="/terms" className="font-medium text-primary underline underline-offset-4">
              Read our Terms of Service
            </Link>
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold">Stay safe when buying or selling</h2>
          <ul className="list-disc space-y-2 pl-5 leading-7 text-foreground/80">
            {tips.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </section>

        <section className="mt-10 rounded-2xl border border-border p-5 sm:p-6">
          <h2 className="text-xl font-semibold">Need help with an account or a report?</h2>
          <p className="mt-2 leading-7 text-muted-foreground">
            For listing concerns, use the Report listing tool so the report is attached to the relevant item. For account or other support requests, email us at{" "}
            <a href="mailto:hello@smartbiz365.site?subject=MaliHub%20Support" className="font-medium text-primary underline underline-offset-4">
              hello@smartbiz365.site
            </a>
            . Please include “MaliHub” in your subject and never send passwords, M-Pesa PINs, or verification codes.
          </p>
        </section>
      </article>
    </Container>
  );
}
