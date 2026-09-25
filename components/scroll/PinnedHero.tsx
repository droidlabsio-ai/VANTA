"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Chapter 1 — the hero holds while the camera pulls back.
 *
 * The section pins for one viewport height. Across that beat the photo settles
 * back and drifts up, the copy lifts and fades, and the whole frame dims as the
 * story hands over to the lookbook.
 *
 * The children are server-rendered (the hero <img> is the LCP element and stays
 * in the SSR HTML — see DECISIONS.md §13). This wrapper only animates them.
 *
 * Every animated property starts at its natural CSS resting state, so there is
 * no `gsap.set()` needed on mount and therefore no flash of an un-animated
 * end-state before JS runs. `filter` is the exception — see the `fromTo` below.
 */
export function PinnedHero({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;

    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();

    mm.add(
      {
        motionOk: "(prefers-reduced-motion: no-preference)",
        isDesktop: "(min-width: 1024px)",
      },
      (context) => {
        const { motionOk, isDesktop } = context.conditions as {
          motionOk: boolean;
          isDesktop: boolean;
        };
        if (!motionOk) return;

        const media = el.querySelector<HTMLElement>("[data-hero-media]");
        const copy = el.querySelector<HTMLElement>("[data-hero-copy]");

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: el,
            start: "top top",
            // Measured: a 90% hold left ~350px of black between the hero
            // releasing and the lookbook arriving. Held long enough to read
            // as a beat, short enough that the next chapter is already
            // arriving. Shorter again on phones, where a long pin stalls.
            end: isDesktop ? "+=55%" : "+=35%",
            scrub: 0.6,
            pin: true,
            pinSpacing: true,
            anticipatePin: 1,
          },
        });

        if (media) {
          tl.to(media, { scale: 0.92, yPercent: -6, ease: "none" }, 0);
          // The camera pulls back (§45): the frame shrinks while the photo
          // inside it un-zooms, so the shot widens instead of just getting
          // smaller. The resting 1.12 is set in `Hero`'s class list, so there
          // is no jump when this takes over.
          const photo = media.querySelector("img");
          if (photo) tl.fromTo(photo, { scale: 1.12 }, { scale: 1, ease: "none" }, 0);
        }
        // Headline lines drift apart at different rates — the top line
        // fastest — so the type separates in depth as the hero leaves.
        el.querySelectorAll<HTMLElement>("[data-hero-copy] [data-hero-line]").forEach((line, i) => {
          tl.to(line, { yPercent: -(60 - i * 18), ease: "none" }, 0);
        });
        if (copy) {
          tl.to(copy, { yPercent: -14, opacity: 0.28, ease: "none" }, 0);
        }
        // Light hand-off only. A deeper dim fought the copy fade and left
        // the frame muddy rather than cinematic.
        //
        // `fromTo`, not `to`: the resting computed filter is `none`, and GSAP
        // cannot infer that the neutral start for `brightness` is 1 — it reads
        // `none` as 0 and the hero renders pure black until you scroll. The
        // start value has to be stated. (This is the one animated property
        // here whose resting CSS value is not also its neutral value.)
        tl.fromTo(
          el,
          { filter: "brightness(1)" },
          { filter: "brightness(0.78)", ease: "none" },
          0,
        );
      },
      el,
    );

    return () => mm.revert();
  }, []);

  return (
    <div ref={root} className="will-change-transform">
      {children}
    </div>
  );
}
