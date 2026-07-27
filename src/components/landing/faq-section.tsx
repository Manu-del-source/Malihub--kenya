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
    <section className="py-24 sm:py-32">
      <Container className="mx-auto flex max-w-3xl flex-col gap-14">
        <SectionHeading eyebrow="Questions" title="Frequently asked questions" />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={defaultViewport}
        >
          <Accordion type="single" collapsible className="flex flex-col gap-3">
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
