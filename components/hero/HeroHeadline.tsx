"use client";

import { motion } from "framer-motion";
import type { HeadlineLine } from "@/data/types";
import { lineReveal, stagger } from "@/lib/motion";
import { Headline } from "@/components/ui/Headline";

interface HeroHeadlineProps {
  lines: HeadlineLine[];
  className?: string;
}

/**
 * Client leaf: masked, staggered line reveal on page load.
 *
 * This is the only part of the hero that needs JS. The hero image is rendered
 * by the server shell so it can paint without waiting for hydration.
 */
export function HeroHeadline({ lines, className }: HeroHeadlineProps) {
  return (
    <motion.div initial="hidden" animate="visible" variants={stagger(0.12, 0.1)}>
      <Headline
        lines={lines}
        as="h1"
        className={className}
        renderLine={(content, i) => (
          <span key={i} data-hero-line className="block overflow-hidden pb-[0.08em]">
            <motion.span variants={lineReveal} className="block">
              {content}
            </motion.span>
          </span>
        )}
      />
    </motion.div>
  );
}
