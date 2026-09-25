"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Ambient light that travels with the viewer.
 *
 * The homepage already tells an environment journey through its backdrop
 * tokens — hot red studio, sunset, burnt orange, then cooling to graphite. This
 * puts that journey behind the whole page as one continuous glow instead of
 * leaving it locked inside the photo panels.
 *
 * Deliberately low-opacity and behind everything: it should register as the
 * room's light changing, not as a colour wash over the design. Nav legibility
 * is unaffected because the glow never rises above the page background's
 * contrast floor.
 */
const STOPS = [
  "#C41E1E", // hero — deep red studio
  "#E01414",
  "#FF6A00", // lookbook — sunset
  "#E8590C", // brand statement — burnt orange
  "#7A0D0D", // product rail — cooling
  "#2B2A2A", // categories
  "#141313", // footer — lights down
];

export function EnvironmentMorph() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const interpolate = gsap.utils.interpolate(STOPS);

      const trigger = ScrollTrigger.create({
        trigger: document.documentElement,
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: (self) => {
          el.style.setProperty("--env", interpolate(self.progress));
        },
      });

      return () => trigger.kill();
    });

    return () => mm.revert();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={
        {
          "--env": STOPS[0],
          background:
            "radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--env) 34%, transparent) 0%, transparent 62%)",
        } as React.CSSProperties
      }
    />
  );
}
