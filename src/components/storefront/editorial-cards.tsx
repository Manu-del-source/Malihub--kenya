import Link from "next/link";
import { ArrowRight, BadgeCheck, ShieldCheck, Store } from "lucide-react";

const guides = [
  { tag: "BUYER GUIDE", title: "Shop with confidence", copy: "Review listing details and seller information before you buy.", href: "/support", icon: ShieldCheck },
  { tag: "SELLER GUIDE", title: "Build trust with buyers", copy: "Keep product details accurate and respond clearly to enquiries.", href: "/support", icon: Store },
  { tag: "MARKETPLACE", title: "Look for verified sellers", copy: "Verification information helps you make informed choices.", href: "/marketplace", icon: BadgeCheck },
];

export function EditorialCards() {
  return <section>
    <div className="mb-5 flex items-center justify-between gap-4"><h2 className="font-display text-2xl text-white sm:text-3xl">Guides &amp; Insights</h2><Link href="/support" className="inline-flex items-center gap-2 text-sm text-[#e6c98b]">Get help <ArrowRight size={15} /></Link></div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {guides.map(({ tag, title, copy, href, icon: Icon }) => <article key={title} className="group rounded-2xl border border-white/[0.08] bg-[#111] p-5 transition hover:border-[#c6a15d]/40">
        <span className="inline-flex size-11 items-center justify-center rounded-xl border border-[#c6a15d]/20 bg-[#c6a15d]/[0.08] text-[#e6c98b]"><Icon size={21} /></span>
        <p className="mt-5 text-[10px] font-semibold tracking-[0.16em] text-[#d8b775]">{tag}</p>
        <h3 className="mt-2 font-display text-xl text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-neutral-400">{copy}</p>
        <Link href={href} className="mt-4 inline-flex items-center gap-2 text-sm text-neutral-300 group-hover:text-[#e6c98b]">Read More <ArrowRight size={15} /></Link>
      </article>)}
    </div>
  </section>;
}
