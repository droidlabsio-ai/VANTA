"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { HeadlineLine } from "@/data/types";
import { headlineText, splitHeadline, type SplitLine } from "@/lib/splitHeadline";
import { cn } from "@/lib/format";

/**
 * Section headline that sets itself character by character as it enters.
 *
 * Accessibility: the split characters are `aria-hidden` and the real string is
 * exposed once via an `sr-only` span. Without that, a screen reader announces
 * the headline one letter at a time.
 *
 * Reduced motion: the animation only registers inside `matchMedia`, and the
 * characters' resting CSS state *is* the finished state — so with motion off
 * the headline simply renders normally, no set-then-restore needed.
 */
export function RevealHeadline({
  lines,
  className,
  as: Tag = "h2",
}: {
  lines: HeadlineLine[];
  className?: string;
  as?: "h1" | "h2";
}) {
  const root = useRef<HTMLDivElement>(null);
  const split = splitHeadline(lines);

  useEffect(() => {
    const el = root.current;
    if (!el) return;

    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const chars = gsap.utils.toArray<HTMLElement>("[data-char]", el);
      if (!chars.length) return;

      // fromTo, not from: the "to" values match the resting CSS exactly, so a
      // refresh mid-scroll can never leave a character stranded mid-air.
      const tween = gsap.fromTo(
        chars,
        { yPercent: 108, opacity: 0 },
        {
          yPercent: 0,
          opacity: 1,
          ease: "power3.out",
          duration: 0.62,
          stagger: 0.014,
          scrollTrigger: { trigger: el, start: "top 82%", once: true },
        },
      );

      return () => {
        tween.scrollTrigger?.kill();
        tween.kill();
        gsap.set(chars, { clearProps: "all" });
      };
    }, el);

    return () => mm.revert();
  }, [lines]);

  return (
    <Tag className={cn("headline", className)}>
      <span className="sr-only">{headlineText(lines)}</span>
      <span ref={root as React.RefObject<HTMLSpanElement>} aria-hidden className="block">
        {split.map((line, li) => (
          <span key={li} className="block overflow-hidden pb-[0.08em]">
            {/*
              Characters are grouped into unbreakable words, with a real space
              between words (§45). Each character is its own inline-block so it
              can rise on its own, and with nothing marking where words end the
              browser was free to wrap between any two of them — on a phone,
              "EVERY MOVE" broke as "EVERY MO / VE".
            */}
            {wordsOf(line).map((word, wi) => (
              <span key={wi}>
                {wi > 0 && " "}
                <span className="inline-block whitespace-nowrap">
                  {word.map((c) => (
                    <span
                      key={c.index}
                      data-char
                      className={cn("inline-block will-change-transform", c.accent && "font-accent font-normal italic normal-case")}
                    >
                      {c.char}
                    </span>
                  ))}
                </span>
              </span>
            ))}
          </span>
        ))}
      </span>
    </Tag>
  );
}

/** A split line as words: runs of non-space characters, spaces dropped. */
function wordsOf(line: SplitLine): SplitLine[] {
  const words: SplitLine[] = [];
  let current: SplitLine = [];
  for (const c of line) {
    if (c.isSpace) {
      if (current.length) words.push(current);
      current = [];
    } else {
      current.push(c);
    }
  }
  if (current.length) words.push(current);
  return words;
}
