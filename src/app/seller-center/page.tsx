import Link from "next/link";
import { ArrowRight, PackageCheck, ShieldCheck, Store } from "lucide-react";
import { Container } from "@/components/ui/container";

export const metadata = {
  title: "Sell on MaliHub — MaliHub Kenya",
  description: "Join the MaliHub Seller Programme and reach buyers across Kenya.",
};

export default function SellerCentrePage() {
  return (
    <main className="min-h-svh bg-[#0A0A0A] text-white">
      <header className="border-b border-white/10 bg-[#111111]">
        <Container className="flex items-center justify-between py-4">
          <Link href="/" className="font-display text-xl font-bold tracking-tight">
            Mali<span className="text-[#FF8C42]">Hub</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/login?next=%2Fseller-center" className="text-white/70 transition hover:text-white">Sign in</Link>
            <Link href="/register" className="rounded-full bg-[#FF8C42] px-4 py-2 font-semibold text-black transition hover:bg-[#ff9b5c]">Create account</Link>
          </div>
        </Container>
      </header>

      <Container className="max-w-5xl py-12 sm:py-16">
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#111111]">
          <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#FFB16F]">
                MaliHub Seller Programme
              </p>
              <h1 className="mt-3 max-w-xl font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Bring your business to MaliHub.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/65">
                Open your shop, reach buyers across Kenya and manage your products and orders from one dedicated Seller Centre.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/register" className="inline-flex items-center gap-2 rounded-full bg-[#FF8C42] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#ff9b5c]">
                  Start your seller journey <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/login?next=%2Fseller-center" className="inline-flex items-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/5">
                  I already have an account
                </Link>
              </div>
              <p className="mt-3 text-xs text-white/45">
                Applications are reviewed by MaliHub before product publishing is enabled.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                <Store className="h-5 w-5 text-[#FFB16F]" aria-hidden />
                <h2 className="mt-3 font-semibold text-white">Your own shop</h2>
                <p className="mt-1 text-sm leading-6 text-white/60">Create a business profile buyers can recognise and trust.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                <PackageCheck className="h-5 w-5 text-[#FFB16F]" aria-hidden />
                <h2 className="mt-3 font-semibold text-white">Manage products and orders</h2>
                <p className="mt-1 text-sm leading-6 text-white/60">Keep listings, stock and customer orders organised.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5 sm:col-span-2 lg:col-span-1">
                <ShieldCheck className="h-5 w-5 text-[#FFB16F]" aria-hidden />
                <h2 className="mt-3 font-semibold text-white">Reviewed applications</h2>
                <p className="mt-1 text-sm leading-6 text-white/60">MaliHub reviews business profiles before sellers can publish listings.</p>
              </div>
            </div>
          </div>
        </section>
      </Container>
    </main>
  );
}
