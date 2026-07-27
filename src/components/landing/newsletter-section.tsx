"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Mail, ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { fadeUp, defaultViewport } from "@/lib/motion";

const newsletterSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

type NewsletterForm = z.infer<typeof newsletterSchema>;

export function NewsletterSection() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NewsletterForm>({ resolver: zodResolver(newsletterSchema) });

  async function onSubmit(data: NewsletterForm) {
    // Phase 7 wires this to a real Server Action (Resend + a Subscriber
    // table). For now it simulates the round trip so the form's UX —
    // validation, loading, success/error states — is fully production-ready.
    await new Promise((resolve) => setTimeout(resolve, 600));
    toast.success(`You're subscribed — we'll email ${data.email} with new drops.`);
    reset();
  }

  return (
    <section className="py-24 sm:py-32">
      <Container>
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
          className="relative mx-auto max-w-2xl overflow-hidden rounded-2xl p-8 text-center sm:p-12"
        >
          <div
            className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/20 via-secondary/15 to-cyan/10"
            aria-hidden
          />
          <div className="glass absolute inset-[1.5px] rounded-2xl" aria-hidden />

          <div className="relative flex flex-col items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary-400">
              <Mail className="h-5 w-5" aria-hidden />
            </div>
            <h2 className="text-balance font-display text-2xl font-medium sm:text-3xl">
              Get the best new listings first
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              One email a week — new drops, price-drop alerts, and marketplace tips.
              No spam, unsubscribe anytime.
            </p>

            <form
              onSubmit={handleSubmit(onSubmit)}
              noValidate
              className="mt-2 flex w-full max-w-md flex-col gap-3 sm:flex-row"
            >
              <div className="flex-1 text-left">
                <label htmlFor="newsletter-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="newsletter-email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "newsletter-email-error" : undefined}
                  className="h-12 w-full rounded-full border border-border bg-background/60 px-5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register("email")}
                />
                {errors.email && (
                  <p id="newsletter-email-error" role="alert" className="mt-1.5 px-2 text-xs text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>
              <Button type="submit" size="lg" disabled={isSubmitting} className="shrink-0">
                {isSubmitting ? "Subscribing…" : "Subscribe"}
                {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
              </Button>
            </form>
          </div>
        </motion.div>
      </Container>
    </section>
  );
}
