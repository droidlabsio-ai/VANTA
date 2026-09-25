"use client";

import { useEffect, type DependencyList, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * One scroll scene, set up the same way every time (§45).
 *
 * Every scene on the home page follows the same three rules, and this hook is
 * where they live so no scene can forget one:
 *
 * - **Reduced motion gets the finished page.** `setup` only runs under
 *   `prefers-reduced-motion: no-preference`. Scenes use `fromTo`, never CSS
 *   that hides things until JavaScript arrives, so with motion off — or with
 *   JavaScript off — every element simply sits in its end state.
 * - **Phones get a smaller version, not a broken one.** `isDesktop` is passed
 *   in so a scene can scale its distances down rather than switch off.
 * - **Everything is torn down.** GSAP's `matchMedia` context records every
 *   tween and ScrollTrigger created inside `setup` and reverts them all on
 *   unmount or when a media query flips, so there is no per-scene cleanup
 *   code to get wrong.
 */
export function useScrollScene<T extends HTMLElement>(
  ref: RefObject<T | null>,
  setup: (el: T, ctx: { isDesktop: boolean }) => void | (() => void),
  deps: DependencyList = [],
) {
  useEffect(() => {
    const el = ref.current;
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
        return setup(el, { isDesktop });
      },
      el,
    );

    return () => mm.revert();
    // `setup` is deliberately not a dependency: scenes pass it inline, and the
    // values it closes over are listed in `deps` by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
