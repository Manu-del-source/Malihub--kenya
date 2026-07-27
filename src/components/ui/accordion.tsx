"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/utils";

const Accordion = AccordionPrimitive.Root;

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn("glass-sm rounded-xl px-1", className)}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        "group flex flex-1 items-center justify-between gap-4 px-5 py-5 text-left font-medium transition-colors hover:text-primary-400",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown
        className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ease-premium group-data-[state=open]:rotate-180 group-data-[state=open]:text-primary-400"
        aria-hidden
      />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = "AccordionTrigger";

/**
 * Smooth open/close without measuring pixel heights: a CSS grid track
 * animates between 0fr and 1fr, driven purely by Radix's [data-state]
 * attribute. Works with `prefers-reduced-motion` automatically via the
 * global transition-duration override in globals.css.
 */
const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    forceMount
    className={cn(
      "grid text-sm text-muted-foreground transition-[grid-template-rows] duration-300 ease-premium",
      "data-[state=open]:grid-rows-[1fr] data-[state=closed]:grid-rows-[0fr]"
    )}
    {...props}
  >
    <div className="overflow-hidden">
      <div className={cn("px-5 pb-5 pt-0", className)}>{children}</div>
    </div>
  </AccordionPrimitive.Content>
));
AccordionContent.displayName = "AccordionContent";

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
