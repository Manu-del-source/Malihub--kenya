import Link from "next/link";
import { ArrowRight, BadgeCheck, ShieldCheck, Store } from "lucide-react";

const guides = [
  { tag: "BUYER GUIDE", title: "Shop with confidence", copy: "Review listing details and seller information before you buy.", href: "/support", icon: ShieldCheck },
  { tag: "SELLER GUIDE", title: "Build trust with buyers", copy: "Keep product details accurate and respond clearly to enquiries.", href: "/support", icon: Store },
  { tag: "MARKETPLACE", title: "Look for verified sellers", copy: "Verification information helps you make informed choices.", href: "/marketplace", icon: BadgeCheck },
];

export function EditorialCards() {
  return <section>
    <div className="mb-5 flex items-center justify-between gap-4"><h2 className="font-display text-2xl text-foreground sm:text-3xl">Guides &amp; Insights</h2><Link href="/support" className="inline-flex items-center gap-2 text-sm text-gold">Get help <ArrowRight size={15} /></Link></div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {guides.map(({ tag, title, copy, href, icon: Icon }) => <article key={title} className="group rounded-2xl border border-foreground/[0.08] bg-card p-5 transition hover:border-gold/40">
        <span className="inline-flex size-11 items-center justify-center rounded-xl border border-gold/20 bg-gold/[0.08] text-gold"><Icon size={21} /></span>
        <p className="mt-5 text-[10px] font-semibold tracking-[0.16em] text-gold">{tag}</p>
        <h3 className="mt-2 font-display text-xl text-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
        <Link href={href} className="mt-4 inline-flex items-center gap-2 text-sm text-foreground/80 group-hover:text-gold">Read More <ArrowRight size={15} /></Link>
      </article>)}
    </div>
  </section>;
}
