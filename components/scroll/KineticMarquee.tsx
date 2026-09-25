"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useScrollScene } from "@/lib/useScrollScene";
import { cn } from "@/lib/format";

/**
 * Two rows of oversized type that slide past each other as the page scrolls
 * (§45) — the cut between the hero and the lookbook.
 *
 * Why it exists: the hero ends on a still, and the lookbook opens on a grid.
 * Without something between them the page reads as two layouts stacked; with
 * the band it reads as one sequence changing scene. The words are the page's
 * own — the hero headline and the trust points — passed in from the published
 * content, so an editor changing either changes this too.
 *
 * Decorative and `aria-hidden`: every phrase here is already on the page as
 * real text. Rows alternate solid and outlined words so the band has rhythm
 * without a second typeface.
 */
export function KineticMarquee({ rows }: { rows: string[][] }) {
  const root = useRef<HTMLDivElement>(null);

  useScrollScene(root, (el, { isDesktop }) => {
    const tracks = gsap.utils.toArray<HTMLElement>("[data-marquee-track]", el);
    const travel = isDesktop ? 22 : 14;
    tracks.forEach((track, i) => {
      const leftward = i % 2 === 0;
      gsap.fromTo(
        track,
        { xPercent: leftward ? 0 : -travel },
        {
          xPercent: leftward ? -travel : 0,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.4 },
        },
      );
    });
  });

  return (
    <div ref={root} aria-hidden className="relative select-none overflow-hidden py-10 lg:py-16">
      {rows.map((words, r) => (
        <div
          key={r}
          data-marquee-track
          className={cn(
            "flex w-max items-center gap-6 whitespace-nowrap will-change-transform lg:gap-10",
            r % 2 === 1 && "-ml-[20vw] mt-2 lg:mt-4",
          )}
        >
          {/* Repeated so the row never runs out while it travels. */}
          {Array.from({ length: 4 }).flatMap((_, rep) =>
            words.map((word, w) => (
              <span key={`${rep}-${w}`} className="flex items-center gap-6 lg:gap-10">
                <span
                  className={cn(
                    "headline text-[13vw] leading-none lg:text-[8.5vw]",
                    (w + r) % 2 === 0 ? "text-bone" : "marquee-outline",
                  )}
                >
                  {word}
                </span>
                <span className="h-3 w-3 shrink-0 rounded-full bg-flare-orange lg:h-4 lg:w-4" />
              </span>
            )),
          )}
        </div>
      ))}
    </div>
  );
}
