import { ArrowLeftRight, MapPin, MessageCircle } from "lucide-react";
import { Container } from "@/components/ui/container";

const benefits = [
  {
    icon: MapPin,
    title: "Discover local finds",
    description: "Explore products listed by sellers in different counties across Kenya.",
  },
  {
    icon: ArrowLeftRight,
    title: "Compare your options",
    description: "Check product details and prices before deciding what works for you.",
  },
  {
    icon: MessageCircle,
    title: "Connect with sellers",
    description: "Reach out to sellers directly to ask questions about a listing.",
  },
];

export function MarketplaceBenefitsSection() {
  return (
    <section aria-labelledby="marketplace-benefits-heading" className="border-b border-border/70 py-10 sm:py-14">
      <Container>
        <div className="mb-6 max-w-xl sm:mb-8">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-400">
            A simpler way to shop
          </p>
          <h2 id="marketplace-benefits-heading" className="font-display text-2xl font-medium leading-tight tracking-[-0.03em] sm:text-3xl">
            Browse. Compare. Connect.
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Everything you need to make a more informed choice, all in one marketplace.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          {benefits.map(({ icon: Icon, title, description }) => (
            <article key={title} className="flex gap-3 rounded-2xl border border-border/70 bg-card/50 p-4 sm:flex-col sm:gap-4 sm:p-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-foreground sm:text-base">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">{description}</p>
              </div>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
