"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/ui/container";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { FAQS } from "@/lib/landing-data";
import { staggerContainer, fadeUp, defaultViewport } from "@/lib/motion";

export function FaqSection() {
  return (
    <section className="py-16 sm:py-24 lg:py-32">
      <Container className="mx-auto flex max-w-4xl flex-col gap-8 sm:gap-12">
        <div className="flex flex-col gap-4 border-b border-border/80 pb-6 sm:flex-row sm:items-end sm:justify-between sm:pb-8">
          <h2 className="max-w-xl font-display text-3xl font-medium leading-tight tracking-[-0.035em] sm:text-4xl lg:text-5xl">Questions before you begin</h2>
          <p className="max-w-xs text-base leading-7 text-muted-foreground">A few useful things to know about using MaliHub.</p>
        </div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
        >
          <Accordion type="single" collapsible className="flex flex-col gap-2 sm:gap-3">
            {FAQS.map((faq, i) => (
              <motion.div key={faq.question} variants={fadeUp}>
                <AccordionItem value={`item-${i}`}>
                  <AccordionTrigger>{faq.question}</AccordionTrigger>
                  <AccordionContent>{faq.answer}</AccordionContent>
                </AccordionItem>
              </motion.div>
            ))}
          </Accordion>
        </motion.div>
      </Container>
    </section>
  );
}
