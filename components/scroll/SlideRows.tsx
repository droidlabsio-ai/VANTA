"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useScrollScene } from "@/lib/useScrollScene";

/**
 * Each `[data-slide]` row slides in from the right as it enters (§45).
 *
 * Why: the category list is a column of giant words, and words that arrive
 * one at a time are read one at a time. Scrubbed per row rather than as one
 * group, so a long list keeps arriving as you scroll instead of having
 * finished before its lower rows are on screen.
 */
export function SlideRows({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useScrollScene(root, (el, { isDesktop }) => {
    gsap.utils.toArray<HTMLElement>("[data-slide]", el).forEach((row) => {
      gsap.fromTo(
        row,
        { xPercent: isDesktop ? 22 : 12, opacity: 0.1 },
        {
          xPercent: 0,
          opacity: 1,
          ease: "power2.out",
          scrollTrigger: { trigger: row, start: "top 98%", end: "top 62%", scrub: 0.5 },
        },
      );
    });
  });

  return (
    <div ref={root} className="overflow-x-clip">
      {children}
    </div>
  );
}
