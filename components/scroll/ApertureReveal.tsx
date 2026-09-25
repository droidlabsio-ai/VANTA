"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useScrollScene } from "@/lib/useScrollScene";

/**
 * Opens the `[data-aperture]` photo like a shutter — a narrow vertical slit
 * widening to the full frame — as the section scrolls into view (§45).
 *
 * Why: Series 026 is the drop, the one piece the page is built around. It gets
 * the single most deliberate reveal on the page; everything else on the home
 * page appears, this one is unveiled. The coloured backdrop of the frame shows
 * around the slit, so the shape reads as an opening rather than a crop.
 *
 * Replaces the old `TiltOnScroll` here: a tilting frame and an opening
 * aperture are two camera moves on one subject, and the eye can follow only
 * one.
 */
export function ApertureReveal({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useScrollScene(root, (el, { isDesktop }) => {
    const aperture = el.querySelector<HTMLElement>("[data-aperture]");
    if (!aperture) return;
    const media = aperture.querySelector("img");
    const slit = isDesktop ? "inset(6% 40% 6% 40%)" : "inset(8% 34% 8% 34%)";

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: aperture,
        start: "top 90%",
        end: isDesktop ? "center 45%" : "center 55%",
        scrub: 0.7,
      },
    });

    tl.fromTo(
      aperture,
      { clipPath: slit },
      { clipPath: "inset(0% 0% 0% 0%)", ease: "power2.inOut" },
      0,
    );
    if (media) tl.fromTo(media, { scale: 1.35 }, { scale: 1, ease: "power2.out" }, 0);
  });

  return <div ref={root}>{children}</div>;
}
