import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";

export function Newsletter() {
  return <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#151515] to-[#0d0d0d] p-6 sm:p-8">
    <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
      <div><h2 className="font-display text-2xl text-white sm:text-3xl">Stay in the Loop</h2><p className="mt-3 max-w-md text-sm leading-6 text-neutral-400">Discover new listings, marketplace updates, and shopping tips from MaliHub.</p></div>
      <Link href="/marketplace" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#b8934a] to-[#e6c98b] px-5 text-sm font-semibold text-[#17130b] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e6c98b]"><Mail size={16} /> Explore latest listings <ArrowRight size={15} /></Link>
    </div>
  </section>;
}
