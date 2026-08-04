"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export function ImageViewer({ src, onClose }: { src: string | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {src && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close image"
            className="glass absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full"
          >
            <X className="h-5 w-5" />
          </button>
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            className="relative h-full max-h-[85vh] w-full max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Image src={src} alt="Shared image" fill sizes="90vw" className="object-contain" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
