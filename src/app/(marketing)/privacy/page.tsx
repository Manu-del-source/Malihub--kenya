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
      "This Privacy Policy explains how MaliHub Kenya (MaliHub, we, us) handles personal information when you browse the marketplace, create an account, publish a listing, contact another user, make or manage an order, submit a report, or otherwise use the website.",
      "MaliHub is an online marketplace service. Information you place in a public listing or public seller profile may be viewed by visitors and search engines. Do not include private information in listing text or photos unless you intend to make it public.",
      "MaliHub Kenya is the service name used for this marketplace. MaliHub has not yet been registered as a company. The marketplace is currently operated by an individual. For privacy questions and requests, contact the MaliHub team at support@malihubke.online. This contact channel does not replace any legal requirement to identify the data controller to you or to the Office of the Data Protection Commissioner; the operator must provide any legally required identity information when exercising your data-protection rights or where required by law.",
    ],
  },
  {
    title: "2. Information we may collect",
    paragraphs: [
      "Account and profile information you submit, such as your name, email address, phone number, profile details, seller or business information, and account preferences.",
      "Listing information, including item descriptions, prices, photos, category, location details, availability, and information you choose to share with potential buyers.",
      "Messages, support requests, reports, verification materials, and other information you send to us or through marketplace features. Do not send passwords, payment PINs, or one-time authentication codes to support staff or other users.",
      "Order, transaction, delivery, payment-status, and dispute records needed to operate the marketplace, support buyers and sellers, prevent fraud, reconcile payments, and meet legal obligations. Where hosted checkout is used, payment credentials are handled by the relevant payment provider; MaliHub does not ask users to disclose their M-Pesa PIN.",
      "Technical and usage information such as device and browser details, IP address, log records, security events, approximate usage events, and cookies or similar technologies used for essential site functionality, security, and (where permitted) analytics.",
    ],
  },
  {
    title: "3. Why we use information and our lawful grounds",
    paragraphs: [
      "We use information to create and manage accounts, authenticate users, publish and search listings, facilitate marketplace interactions, process orders and payment status updates, support delivery and dispute workflows where available, respond to requests, protect users and the service, detect fraud or abuse, troubleshoot technical issues, and comply with applicable law.",
      "Depending on the purpose and circumstances, processing may be necessary to provide a service or take steps requested by you, comply with a legal obligation, protect vital interests, perform a task carried out in the public interest where applicable, pursue legitimate interests that are not overridden by your rights, or obtain your consent. Where we rely on consent, you may withdraw it; withdrawal does not affect processing already lawfully carried out.",
      "We aim to collect only information that is relevant and reasonably necessary for the stated purpose. If you do not provide information required for an account, seller verification, order, or support request, the relevant feature or request may not be available.",
    ],
  },
  {
    title: "4. How information may be shared",
    paragraphs: [
      "Public listing details and seller profile information you choose to publish may be visible to other users. Information you send directly to another user is shared with that recipient. Order information may be shared with the relevant buyer, seller, delivery provider, or payment provider to the extent needed to complete or support the transaction.",
      "We use service providers to help operate MaliHub. Depending on which features you use and the production configuration, these may include Vercel for website hosting and delivery, Neon for database and authentication services, Cloudinary for image storage and delivery, Resend for transactional email, Google Analytics for analytics after consent, and Paystack for hosted payment processing. These providers process information under their own service terms and applicable data-protection obligations; the exact information shared depends on the feature used.",
      "We may disclose limited information to professional advisers, regulators, law-enforcement bodies, courts, or other parties where reasonably necessary to comply with law or a lawful request, protect users, investigate suspected fraud, enforce our terms, or protect the rights and security of MaliHub and its users.",
      "We do not sell personal information as a product. We do not authorise service providers to use information they process for MaliHub for unrelated purposes except where their own role and applicable law permit it.",
    ],
  },
  {
    title: "5. International processing and transfers",
    paragraphs: [
      "Some technology providers used to operate MaliHub may store or process information in data centres outside Kenya. Where personal data is transferred outside Kenya, MaliHub is responsible for assessing the transfer and ensuring that a lawful transfer basis and appropriate safeguards are in place as required by the Data Protection Act, 2019 and applicable regulations. The countries and safeguards depend on the provider, service configuration, and data involved.",
      "We will provide further details about relevant transfer destinations and safeguards when these have been confirmed against the active provider contracts and account configurations. You may contact support@malihubke.online with a question about international processing.",
    ],
  },
  {
    title: "6. Cookies, security, and retention",
    paragraphs: [
      "Essential cookies or similar technologies are used to keep you signed in, maintain security, remember necessary settings, and make the website function. These are required for the service. You can control cookies through your browser, but disabling essential cookies may affect sign-in, checkout, or other features.",
      "With your permission (the 'Accept all' choice on our cookie banner), we use Google Analytics cookies to understand how MaliHub is used and improve it. If you choose 'Essential only', analytics should not load. You can change or withdraw your choice at any time using 'Cookie settings' in the footer. The cookie banner's optional analytics category currently covers Google Analytics; if other non-essential tracking is introduced, the settings and this policy should be updated before it is activated.",
      "We use reasonable technical and organisational measures intended to protect information, including access controls and security monitoring. No website or transmission method can be guaranteed completely secure. Protect your password and never share payment PINs or one-time codes.",
      "We keep personal information only for as long as reasonably necessary for the purpose for which it was collected, including operating accounts and listings, completing and supporting transactions, handling disputes, preventing fraud, maintaining required business and payment records, enforcing our terms, and meeting legal obligations. When information is no longer required, we will take reasonable steps to delete or anonymise it, subject to backups, legal retention requirements, and the need to preserve evidence of disputes or security incidents.",
    ],
  },
  {
    title: "7. Your data protection rights",
    paragraphs: [
      "Subject to the Data Protection Act, 2019 and applicable law, you may have the right to be informed about the use of your personal data, request access to it, request correction of inaccurate or misleading information, request deletion where the law permits, object to or restrict certain processing, request data portability where applicable, and withdraw consent where processing relies on consent.",
      "To exercise a right, email support@malihubke.online with the subject 'Privacy request'. Tell us which right you wish to exercise and provide enough information for us to locate the relevant account or records. Do not include your password, M-Pesa PIN, or one-time verification code. We may ask for reasonable proof of identity before acting. We will respond within the period required by applicable law.",
      "Some information may need to be retained where required by law or where necessary to establish, exercise, or defend legal claims, resolve a dispute, prevent fraud, or protect the service. If you are dissatisfied with our handling of a request, you may raise a complaint with the Office of the Data Protection Commissioner in Kenya.",
    ],
  },
  {
    title: "8. Children and changes to this policy",
    paragraphs: [
      "MaliHub is not designed for children to independently create accounts or enter marketplace transactions. If you believe a child has provided personal information inappropriately, contact us so the matter can be reviewed.",
      "We may update this policy as the service, providers, or legal requirements change. The 'Last updated' date indicates when this version was revised. We will take reasonable steps to draw attention to material changes where appropriate.",
    ],
  },
  {
    title: "9. Contact",
    paragraphs: [
      "For privacy questions, access or correction requests, deletion requests, objections, or other data-protection concerns, email support@malihubke.online with the subject 'Privacy request'. For general marketplace support, use support@malihubke.online. Do not send passwords, payment PINs, or authentication codes.",
      "Office of the Data Protection Commissioner (Kenya): https://www.odpc.go.ke/contact-us/.",
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <Container className="marketing-page py-16 sm:py-20">
      <article className="marketing-document mx-auto max-w-3xl rounded-3xl border border-foreground/[0.07] bg-card/75 px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:px-10 sm:py-10">
        <p className="text-sm font-medium text-primary">Legal</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: 1 November 2026</p>
        <p className="mt-6 leading-7 text-muted-foreground">
          This policy explains how MaliHub handles personal information. It should be read together with the Terms of Service and Cookie Settings.
        </p>
        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <section key={section.title} id={section.title.startsWith("6.") ? "cookies" : undefined} className="scroll-mt-24 space-y-3">
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
