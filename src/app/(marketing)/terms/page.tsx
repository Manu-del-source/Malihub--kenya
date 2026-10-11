import type { Metadata } from "next";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Terms of Service | MaliHub Kenya",
  description: "Read the terms that apply when using the MaliHub Kenya marketplace.",
  alternates: { canonical: "/terms" },
};

const sections = [
  {
    title: "1. About MaliHub",
    paragraphs: [
      "MaliHub provides an online marketplace where users can browse listings and, where the relevant features are available, publish items, contact sellers, or initiate purchases. These Terms of Service apply when you access or use the service.",
      "MaliHub is not the seller of items listed by users. Unless a transaction page expressly says otherwise, the agreement to sell an item is between the buyer and the seller. A listing on MaliHub is not a guarantee that an item is available, authentic, safe, or as described.",
    ],
  },
  {
    title: "2. Accounts and eligibility",
    paragraphs: [
      "Provide accurate information when registering and keep your account details up to date. You are responsible for activity carried out through your account and for keeping login credentials confidential. Notify us through the website if you suspect unauthorised access.",
      "You must be legally capable of entering into the transactions you undertake. If you are not legally able to do so independently, use the service only with appropriate involvement from a parent, guardian, or other legally authorised person.",
    ],
  },
  {
    title: "3. Listings and user conduct",
    paragraphs: [
      "You are responsible for the accuracy, legality, pricing, availability, condition, and ownership of items you list. Use photos and descriptions that fairly represent the item, and update or remove a listing when it is no longer available.",
      "You must not post counterfeit, stolen, illegal, dangerous, or otherwise prohibited goods; mislead users; impersonate another person; manipulate reviews or listings; harass users; interfere with the service; or use the platform for fraud, money laundering, or other unlawful activity.",
      "Do not publish another person's private information or content you do not have permission to use. You remain responsible for the content you submit and must have the rights needed to publish it.",
    ],
  },
  {
    title: "4. Purchases, payments, and fees",
    paragraphs: [
      "Before agreeing to buy, review the listing, ask the seller questions, and confirm important details such as condition, delivery or collection arrangements, and the final price. Do not assume a payment, delivery, refund, or buyer-protection feature exists unless the checkout or relevant product screen expressly offers it.",
      "Use only payment methods displayed as available for your transaction and follow the payment provider's instructions. Never share an M-Pesa PIN, password, or one-time verification code with a seller or another user. A screenshot or message is not proof that money has been received.",
      "Any platform fee or charge must be shown to you before you confirm the relevant paid action. Provider fees, where applicable, may be governed by the provider's own terms.",
      "Unless a specific written policy or mandatory law provides otherwise, buyers and sellers are responsible for resolving transaction issues directly with each other. This does not remove any rights you have under applicable consumer or other laws.",
    ],
  },
  {
    title: "5. Safety, reports, and moderation",
    paragraphs: [
      "Use reasonable care when communicating, paying, collecting items, or meeting another user. For in-person exchanges, choose a public place and do not proceed if you feel unsafe.",
      "You may report suspicious listings or conduct using available reporting tools. We may review, restrict, remove, or disable content or accounts where reasonably necessary to protect users, comply with law, enforce these terms, or maintain the service. We do not guarantee that every listing or user will be reviewed or verified.",
    ],
  },
  {
    title: "6. Content and service availability",
    paragraphs: [
      "You retain rights you already hold in content you submit. You give MaliHub permission to host, store, reproduce, format, and display that content as needed to operate, promote, secure, and improve the marketplace. This permission is limited to those purposes and lasts while the content is needed for the service, subject to backups and legal obligations.",
      "We aim to keep the service available but do not guarantee uninterrupted access, error-free operation, a particular number of listings or users, or that every feature will always be available. Features may change, be paused, or be withdrawn.",
    ],
  },
  {
    title: "7. Disclaimers and liability",
    paragraphs: [
      "To the extent permitted by law, the marketplace is provided on an 'as available' basis. We do not endorse every user or independently guarantee the truth of every listing, and we are not responsible for a buyer's or seller's conduct merely because a listing appears on the platform.",
      "Nothing in these terms excludes or limits a right or liability that cannot lawfully be excluded or limited under Kenyan law. To the extent permitted by law, MaliHub is not liable for indirect or consequential loss arising from user-to-user transactions, inaccurate user content, or temporary service interruptions.",
    ],
  },
  {
    title: "8. Suspension, changes, and governing law",
    paragraphs: [
      "We may suspend or restrict access where we reasonably believe an account has breached these terms, presents a safety or security risk, or must be restricted by law. Where appropriate, we may ask for additional information to investigate a report.",
      "We may update these terms as the service or legal requirements change. The version published on this page applies from its stated update date. Continued use after an update means you accept the updated terms to the extent permitted by law.",
      "These terms are governed by the laws of Kenya, subject to any mandatory rights and protections that apply to you. For questions or complaints, use the contact/support channel provided on the MaliHub website.",
    ],
  },
];

export default function TermsPage() {
  return (
    <Container className="py-12 sm:py-16">
      <article className="mx-auto max-w-3xl">
        <p className="text-sm font-medium text-primary">Legal</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Terms of Service</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: 11 October 2026</p>
        <p className="mt-6 leading-7 text-muted-foreground">
          Please read these terms before using MaliHub. By accessing the marketplace, you agree to follow these terms and applicable law.
        </p>
        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <section key={section.title} className="space-y-3">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="leading-7 text-foreground/80">{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </Container>
  );
}
