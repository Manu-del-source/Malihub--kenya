import { BadgeCheck, ShieldCheck, Headset, HeartHandshake } from "lucide-react";

const items = [
  { icon: BadgeCheck, title: "Verified Sellers", copy: "Verification where available" },
  { icon: ShieldCheck, title: "Secure Checkout", copy: "Payment flow built for trust" },
  { icon: Headset, title: "Support When Needed", copy: "Help for marketplace questions" },
  { icon: HeartHandshake, title: "Made for Kenya", copy: "Local buyers and sellers" },
];

export function TrustBar() {
  return <section aria-label="MaliHub marketplace features" className="grid grid-cols-2 gap-5 border-y border-white/[0.08] py-7 lg:grid-cols-4">
    {items.map(({ icon: Icon, title, copy }) => <div key={title} className="flex items-start gap-3"><Icon className="mt-1 shrink-0 text-[#d8b775]" size={22} /><div><h3 className="text-sm font-medium text-white">{title}</h3><p className="mt-1 text-xs leading-5 text-neutral-500">{copy}</p></div></div>)}
  </section>;
}
