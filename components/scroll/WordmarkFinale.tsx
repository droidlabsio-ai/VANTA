"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useScrollScene } from "@/lib/useScrollScene";

/**
 * The closing shot: the wordmark, the full width of the screen, rising letter
 * by letter as the page runs out (§45).
 *
 * Why: the environment morph has already dimmed the page to the footer's near
 * black. Ending on the name — the only thing left on screen — is the credits
 * after the film, and tells the visitor they have reached the end rather than
 * that the page merely stopped.
 *
 * `aria-hidden`: the footer directly below carries the real, linked wordmark.
 */
export function WordmarkFinale({ word }: { word: string }) {
  const root = useRef<HTMLDivElement>(null);

  useScrollScene(root, (el) => {
    const letters = gsap.utils.toArray<HTMLElement>("[data-letter]", el);
    gsap.fromTo(
      letters,
      { yPercent: 105 },
      {
        yPercent: 0,
        ease: "power3.out",
        stagger: 0.06,
        scrollTrigger: { trigger: el, start: "top 95%", end: "bottom 85%", scrub: 0.6 },
      },
    );
  }, [word]);

  return (
    <div ref={root} aria-hidden className="select-none overflow-hidden px-gutter pt-10 lg:px-gutter-lg">
      <div className="headline flex justify-between text-[25vw] leading-[0.8] text-bone lg:text-[21vw]">
        {Array.from(word).map((letter, i) => (
          <span key={i} className="block overflow-hidden pb-[0.02em]">
            <span data-letter className="block will-change-transform">
              {letter}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
