"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion, animate } from "framer-motion";

/**
 * Animates a number from 0 to `target` when the returned ref scrolls into
 * view, once. Returns the live value plus the ref to attach to the element
 * that should trigger the animation.
 */
export function useCountUp(target: number, options?: { duration?: number }) {
  const ref = useRef<HTMLElement | null>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!isInView) return;

    if (reduceMotion) {
      setValue(target);
      return;
    }

    const controls = animate(0, target, {
      duration: options?.duration ?? 2,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setValue(Math.round(latest)),
    });

    return () => controls.stop();
  }, [isInView, target, reduceMotion, options?.duration]);

  return { ref, value };
}
