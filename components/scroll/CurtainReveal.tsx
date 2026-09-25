"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useScrollScene } from "@/lib/useScrollScene";

/**
 * Wipes each `[data-curtain]` frame open from the top down, one after another,
 * while the photograph inside settles from a slight zoom (§45).
 *
 * Why: the looks are the first time the clothes are shown on bodies. A
 * staggered curtain turns three photos appearing into three reveals, and the
 * zoom settling as each opens is what makes it feel shot rather than faded.
 *
 * Top down, because that is the edge that scrolls into view first: wiping
 * from the bottom kept a frame blank until it was almost fully on screen
 * (seen in a browser, and changed).
 *
 * Only `clip-path` and `transform` move — both composited, neither triggers
 * layout. The frames' own Framer fade-in (`RevealItem`) is on an ancestor and
 * animates different properties, so the two do not fight.
 */
export function CurtainReveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useScrollScene(root, (el, { isDesktop }) => {
    const frames = gsap.utils.toArray<HTMLElement>("[data-curtain]", el);
    if (!frames.length) return;

    const tl = gsap.timeline({
      // Timed off the first frame, not the section: the section's top padding
      // would otherwise spend the reveal while the photos are still below the
      // fold. Measured in a browser before this was changed.
      scrollTrigger: {
        trigger: frames[0],
        start: "top 98%",
        end: isDesktop ? "top 35%" : "top 50%",
        scrub: 0.6,
      },
    });

    frames.forEach((frame, i) => {
      const media = frame.querySelector("img");
      const at = i * 0.18;
      tl.fromTo(
        frame,
        { clipPath: "inset(0% 0% 100% 0%)" },
        { clipPath: "inset(0% 0% 0% 0%)", ease: "power2.out", duration: 0.6 },
        at,
      );
      if (media) {
        tl.fromTo(media, { scale: 1.28 }, { scale: 1, ease: "power2.out", duration: 0.75 }, at);
      }
    });
  });

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
