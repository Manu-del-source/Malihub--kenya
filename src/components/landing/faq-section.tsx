"use client";

import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/section-heading";
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
    <section className="py-10 sm:py-20 lg:py-28">
      <Container className="mx-auto flex max-w-3xl flex-col gap-6 sm:gap-10 lg:gap-14">
        <SectionHeading eyebrow="Questions" title="Frequently asked questions" />

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
