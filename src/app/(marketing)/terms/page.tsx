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
      "MaliHub is a marketplace platform, not the seller of items listed by users. Unless a transaction page expressly says otherwise, the agreement to sell an item is between the buyer and the seller. A listing on MaliHub is not, by itself, a guarantee that an item is available, authentic, safe, or as described.",
    ],
  },
  {
    title: "2. Accounts and eligibility",
    paragraphs: [
      "Provide accurate information when registering and keep your account details up to date. You are responsible for activity carried out through your account and for keeping login credentials confidential. Notify us through the website if you suspect unauthorised access.",
      "You must be legally capable of entering into the transactions you undertake. If you are not legally able to do so independently, use the service only with appropriate involvement from a parent, guardian, or other legally authorised person.",
      "MaliHub may request additional information to establish account ownership, investigate suspicious activity, or assess seller applications. Do not submit passwords, M-Pesa PINs, or one-time authentication codes as verification documents.",
    ],
  },
  {
    title: "3. Seller responsibilities and verification",
    paragraphs: [
      "Sellers are responsible for the accuracy, legality, pricing, availability, condition, authenticity, ownership, and description of every item they list. Product photos and descriptions must fairly represent the item offered. Sellers must update, pause, or remove listings promptly when an item is unavailable or the information becomes inaccurate.",
      "Before accepting an order, sellers must ensure they can fulfil it and must communicate material details such as customisation, production time, stock status, delivery options, delivery charges, and any limitations. Sellers must not accept payment for goods they do not intend or are unable to supply.",
      "Where MaliHub requests seller or business verification, the seller must provide accurate and current information and promptly notify MaliHub of material changes. A 'verified' status means only that MaliHub has completed the checks described for that status; it is not a guarantee of product quality, seller solvency, future conduct, fulfilment, or the outcome of a transaction.",
      "Sellers must not use sample, mock-up, or demonstration listings to imply that goods are available for purchase. Any showcase-only or demonstration listing must be clearly labelled and must not accept orders or payments. Sellers must have the rights needed to use product images and other listing content.",
      "Sellers must comply with applicable consumer, tax, product-safety, intellectual-property, advertising, and other laws relevant to their business and products.",
    ],
  },
  {
    title: "4. Listings and prohibited conduct",
    paragraphs: [
      "You must not post counterfeit, stolen, illegal, dangerous, restricted, or otherwise prohibited goods; mislead users; impersonate another person or business; manipulate reviews or listings; harass users; interfere with the service; or use the platform for fraud, money laundering, or other unlawful activity.",
      "Do not publish another person's private information or content you do not have permission to use. You remain responsible for the content you submit and must have the rights needed to publish it.",
      "MaliHub may reject, restrict, hide, or remove a listing that appears inaccurate, unsafe, unlawful, misleading, or inconsistent with these terms or platform rules. We may request evidence or clarification before restoring it.",
    ],
  },
  {
    title: "5. Orders, payments, delivery, and cancellations",
    paragraphs: [
      "Before placing or accepting an order, review the listing and confirm important details, including the item, quantity, customisation, condition, total price, availability, production time, delivery or collection method, and any additional charges. An order is subject to the confirmation and status shown in the relevant MaliHub order flow.",
      "Use only payment methods displayed as available for your transaction and follow the payment provider's instructions. A payment screenshot, SMS, or message is not proof that funds have been received; rely on the payment status confirmed in the service or by the payment provider. Never share an M-Pesa PIN, password, or one-time verification code with a seller or another user.",
      "The seller is responsible for preparing and handing over or dispatching the goods as agreed in the order. Where tracking or delivery features are available, use the information shown in the order. Delivery estimates are not guarantees unless expressly stated as such.",
      "Cancellation, refund, return, and failed-delivery handling depend on the order status, the applicable listing or checkout terms, any MaliHub policy displayed for that transaction, the payment provider's rules, and mandatory consumer law. Do not assume a refund, return window, escrow, inspection period, or buyer-protection feature exists unless it is expressly presented in the relevant transaction flow or policy.",
      "Any platform fee or charge must be shown before you confirm the relevant paid action. Provider fees, where applicable, may be governed by the provider's own terms.",
    ],
  },
  {
    title: "6. Disputes, reports, and moderation",
    paragraphs: [
      "If an order problem arises, contact the other party promptly and keep relevant evidence, such as order details, payment references, delivery records, and communications. Use the support or reporting channel shown on MaliHub to raise a concern. Do not send passwords, payment PINs, or one-time codes as evidence.",
      "MaliHub may review information available to it, request further evidence, communicate with the parties, and take action permitted by the platform's features and policies, including restricting an account or listing. Unless a specific transaction policy says otherwise, MaliHub does not guarantee a particular dispute outcome and does not act as a court or provide legal representation.",
      "You may report suspicious listings or conduct using available reporting tools. A report is a request for review, not a guarantee that the listing has already been checked or removed. We may review, restrict, remove, or disable content or accounts where reasonably necessary to protect users, comply with law, enforce these terms, or maintain the service.",
    ],
  },
  {
    title: "7. Safety and user conduct",
    paragraphs: [
      "Use reasonable care when communicating, paying, collecting items, or meeting another user. For in-person exchanges, choose a public place and do not proceed if you feel unsafe.",
      "Be alert to requests for advance payments, unusual payment arrangements, or sensitive authentication information. Where an order is managed through MaliHub, keep relevant order details and payment references in the order flow or support channel where available so they can be used to help review a problem.",
    ],
  },
  {
    title: "8. Content and service availability",
    paragraphs: [
      "You retain rights you already hold in content you submit. You give MaliHub permission to host, store, reproduce, format, and display that content as needed to operate, secure, support, and promote the marketplace. This permission is limited to those purposes and lasts while the content is needed for the service, subject to backups and legal obligations.",
      "We aim to keep the service available but do not guarantee uninterrupted access, error-free operation, a particular number of listings or users, or that every feature will always be available. Features may change, be paused, or be withdrawn.",
    ],
  },
  {
    title: "9. Disclaimers and liability",
    paragraphs: [
      "To the extent permitted by law, the marketplace is provided on an 'as available' basis. We do not endorse every user or independently guarantee the truth of every listing, and we are not responsible for a buyer's or seller's conduct merely because a listing appears on the platform.",
      "Nothing in these terms excludes or limits a right or liability that cannot lawfully be excluded or limited under Kenyan law. To the extent permitted by law, MaliHub is not liable for indirect or consequential loss arising from user-to-user transactions, inaccurate user content, or temporary service interruptions.",
    ],
  },
  {
    title: "10. Suspension, changes, and governing law",
    paragraphs: [
      "We may suspend or restrict access where we reasonably believe an account has breached these terms, presents a safety or security risk, or must be restricted by law. Where appropriate, we may ask for additional information to investigate a report. We may take account of the seriousness and repetition of the conduct when deciding what action is proportionate.",
      "We may update these terms as the service or legal requirements change. The version published on this page applies from its stated update date. Material changes will be reflected on this page.",
      "These terms are governed by the laws of Kenya, subject to any mandatory rights and protections that apply to you. For questions or complaints, contact support@malihubke.online.",
    ],
  },
];

export default function TermsPage() {
  return (
    <Container className="marketing-page py-16 sm:py-20">
      <article className="marketing-document mx-auto max-w-3xl rounded-3xl border border-foreground/[0.07] bg-card/75 px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:px-10 sm:py-10">
        <p className="text-sm font-medium text-primary">Legal</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Terms of Service</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: 1 November 2026</p>
        <p className="mt-6 leading-7 text-muted-foreground">
          Please read these terms before using MaliHub. They apply to buyers, sellers, and other visitors using the marketplace, subject to applicable law.
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
