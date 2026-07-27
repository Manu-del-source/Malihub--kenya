import type { Variants } from "framer-motion";

/** Standard scroll-reveal: fade + rise, used on nearly every section heading and card. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Parent wrapper that staggers its children's fadeUp animation. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

/** Slightly larger rise for hero-scale elements. */
export const fadeUpLarge: Variants = {
  hidden: { opacity: 0, y: 36 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Simple opacity-only fade, for elements where vertical movement would be too much. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.6, ease: "easeOut" } },
};

/** Default viewport config for whileInView triggers — fires once, slightly before fully visible. */
export const defaultViewport = { once: true, margin: "-80px" };
