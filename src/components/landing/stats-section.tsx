"use client";

import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { KenyaMapSignature } from "@/components/landing/kenya-map-signature";
import { STATS } from "@/lib/landing-data";
import { useCountUp } from "@/hooks/use-count-up";

function StatCounter({ value, label, suffix }: { value: number; label: string; suffix: string }) {
  const { ref, value: current } = useCountUp(value);
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className="flex flex-col gap-1">
      <p className="font-mono text-4xl font-medium tabular-nums text-foreground sm:text-5xl">
        {current.toLocaleString()}
        {suffix}
      </p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function StatsSection() {
  return (
    <section className="py-24 sm:py-32">
      <Container className="grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
        <div className="flex flex-col gap-10">
          <SectionHeading
            align="left"
            eyebrow="Nationwide"
            title="Kenya's marketplace, county by county"
            subtitle="MaliHub isn't just live in Nairobi and Mombasa — it's built for the whole country."
          />
          <div className="grid grid-cols-2 gap-8">
            {STATS.map((stat) => (
              <StatCounter key={stat.label} value={stat.value} label={stat.label} suffix={stat.suffix} />
            ))}
          </div>
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-md">
          <div className="glass absolute inset-0 rounded-2xl" />
          <div className="absolute inset-6">
            <KenyaMapSignature />
          </div>
        </div>
      </Container>
    </section>
  );
}
