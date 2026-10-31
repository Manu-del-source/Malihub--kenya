import type { Metadata } from "next";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Privacy Policy | MaliHub Kenya",
  description: "Learn how MaliHub Kenya handles account, listing, and usage information.",
  alternates: { canonical: "/privacy" },
};

const sections = [
  {
    title: "1. Who this policy applies to",
    paragraphs: [
      "This Privacy Policy explains how MaliHub Kenya (MaliHub, we, us) handles personal information when you browse the marketplace, create an account, publish a listing, contact another user, or otherwise use the website.",
      "MaliHub is a marketplace service. The information visible on a public listing may be viewed by other visitors, so do not include personal information in listing text or photos unless you intend to make it public.",
    ],
  },
  {
    title: "2. Information we may collect",
    paragraphs: [
      "Account and profile information you submit, such as your name, email address, phone number, profile details, and account preferences.",
      "Listing information, including item descriptions, prices, photos, location details, and information you choose to share with potential buyers.",
      "Messages, support requests, reports, and other information you send to us or through marketplace features.",
      "Transaction and payment-related records needed to operate the service, respond to disputes, prevent fraud, and meet legal obligations. Payment credentials should be handled by the payment provider where its checkout is used; do not send PINs or passwords to MaliHub users.",
      "Technical and usage information such as device/browser details, log records, approximate usage events, and cookies or similar technologies used for essential site functionality and security.",
    ],
  },
  {
    title: "3. Why we use information",
    paragraphs: [
      "We use information to provide and maintain accounts and listings, enable search and marketplace interactions, respond to support requests, protect users and the service, detect fraud or abuse, troubleshoot technical issues, and comply with applicable law.",
      "Where consent is required, we will ask for it before using information for that purpose. We do not promise a feature or payment method is available unless it is actually presented in the product.",
    ],
  },
  {
    title: "4. How information may be shared",
    paragraphs: [
      "Public listing details and profile information you choose to publish may be visible to other users. Information you send directly to another user is shared with that recipient.",
      "We may share limited information with service providers that help host the website, operate authentication, store images, provide support, protect against abuse, or process a transaction you choose to make. Providers should receive only information needed for their role and are subject to applicable contractual or legal safeguards.",
      "We may disclose information where reasonably necessary to comply with law, respond to lawful requests, protect users, investigate suspected fraud, or protect our rights and the security of the service. We do not sell personal information as a product.",
    ],
  },
  {
    title: "5. Cookies, security, and retention",
    paragraphs: [
      "Essential cookies or similar technologies may be used to keep you signed in, maintain security, and make the website function. You can control cookies through your browser, but disabling essential cookies may affect features.",
      "We use reasonable technical and organisational measures intended to protect information. No website or transmission method can be guaranteed completely secure, so protect your password and never share payment PINs or one-time codes.",
      "We retain information for as long as needed to operate the service, maintain legitimate business records, resolve disputes, enforce our terms, and meet legal obligations. Retention periods vary by information type and purpose.",
    ],
  },
  {
    title: "6. Your choices and data protection rights",
    paragraphs: [
      "Subject to applicable law, including Kenya's Data Protection Act, 2019, you may have rights to request access to, correction of, or deletion of personal information, object to or restrict certain processing, or withdraw consent where processing relies on consent.",
      "Some information must be retained where the law requires it or where it is necessary to resolve a dispute or protect the service. We may need to verify your identity before acting on a request.",
    ],
  },
  {
    title: "7. Children and changes to this policy",
    paragraphs: [
      "The marketplace is not intended for children to use independently to enter transactions. If you believe a child has provided personal information inappropriately, contact us through the website so the matter can be reviewed.",
      "We may update this policy as the service or legal requirements change. The date below indicates when this version was published. Material changes will be reflected on this page.",
    ],
  },
  {
    title: "8. Contact",
    paragraphs: [
      "For privacy questions or requests concerning your personal information, use the contact/support channel provided on the MaliHub website. Include enough detail for us to understand your request, but do not send passwords, payment PINs, or other authentication secrets.",
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <Container className="marketing-page py-16 sm:py-20">
      <article className="marketing-document mx-auto max-w-3xl rounded-3xl border border-foreground/[0.07] bg-card/75 px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:px-10 sm:py-10">
        <p className="text-sm font-medium text-primary">Legal</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: 11 October 2026</p>
        <p className="mt-6 leading-7 text-muted-foreground">
          This policy describes the information MaliHub may handle and how it is used. It should be read together with the Terms of Service.
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
