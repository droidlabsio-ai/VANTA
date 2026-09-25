"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useScrollScene } from "@/lib/useScrollScene";

/**
 * Product cards rise into place at staggered heights, each starting with a
 * slight alternating lean that straightens as it lands (§45).
 *
 * Why: the rail is where browsing turns into buying, and it is the first
 * place several products share the screen. Arriving at different rates makes
 * each card register on its own before the row settles into a grid.
 *
 * Desktop only for the lean: on a phone the cards sit in a horizontal swipe
 * rail, where a vertical rise is barely visible and a lean fights the swipe.
 * Phones get a short, flat rise instead.
 */
export function RiseIn({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useScrollScene(root, (el, { isDesktop }) => {
    const cards = gsap.utils.toArray<HTMLElement>("[data-rise]", el);
    if (!cards.length) return;

    const tl = gsap.timeline({
      // Timed off the first card rather than the section, whose heading and
      // padding would use up the rise before the cards are on screen.
      scrollTrigger: {
        trigger: cards[0],
        start: "top 100%",
        end: isDesktop ? "top 45%" : "top 60%",
        scrub: 0.6,
      },
    });

    cards.forEach((card, i) => {
      const depth = 1 + (i % 3) * 0.35;
      tl.fromTo(
        card,
        isDesktop
          ? { y: 160 * depth, rotate: i % 2 === 0 ? -3.5 : 3.5, opacity: 0 }
          : { y: 50, opacity: 0 },
        { y: 0, rotate: 0, opacity: 1, ease: "power3.out", duration: 0.7 },
        i * 0.08,
      );
    });
  });

  return <div ref={root}>{children}</div>;
}
