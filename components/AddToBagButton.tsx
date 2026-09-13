"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useBag } from "@/components/BagProvider";
import { duration, ease, tapScale } from "@/lib/motion";
import { cn } from "@/lib/format";

/**
 * Adds one product to the bag.
 *
 * Confirms in place rather than navigating. Sending someone to the bag on
 * every add interrupts the thing they were doing — browsing — and makes buying
 * a second item cost two extra page loads. The button states what happened and
 * offers the bag as a choice.
 */
export function AddToBagButton({
  productId,
  blockedReason = null,
  onBlockedClick,
}: {
  productId: string;
  /**
   * Why the button cannot be used yet — "Select a size", "Sold out" — or null.
   *
   * Shown beneath the button, in text, whenever it applies. A button that is
   * visibly unavailable with no stated reason reads as a broken site, and the
   * person most likely to hit it is the one who has already decided to buy.
   */
  blockedReason?: string | null;
  /** Called when the button is pressed while blocked — to move focus to the size picker, say. */
  onBlockedClick?: () => void;
}) {
  const { add, hydrated } = useBag();
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintId = useId();
  const blocked = blockedReason !== null;

  // Clearing on unmount stops the timer firing into a component that has gone.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = () => {
    if (blocked) {
      onBlockedClick?.();
      return;
    }
    add(productId);
    setJustAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setJustAdded(false), 4000);
  };

  return (
    <div className="space-y-3">
      <motion.button
        type="button"
        onClick={onClick}
        /**
         * Disabled until the stored bag has been read. A click before that
         * would add to an empty bag and then be overwritten by whatever was
         * already saved — the item would silently vanish.
         */
        disabled={!hydrated}
        /**
         * Blocked is `aria-disabled`, not `disabled`, and on purpose. A natively
         * disabled button leaves the tab order and is skipped by many screen
         * readers, so someone tabbing towards it never hears why it cannot be
         * pressed. This one stays focusable, announces itself as unavailable,
         * and reads the reason out through `aria-describedby`.
         */
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? hintId : undefined}
        whileTap={hydrated && !blocked ? tapScale : undefined}
        transition={{ duration: duration.fast, ease: ease.inOut }}
        className={cn(
          "inline-flex w-full items-center justify-center rounded-full px-8 py-4 text-label-lg font-bold uppercase transition-colors duration-200 ease-in-out sm:w-auto",
          "bg-bone text-ink hover:bg-white",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-bone",
        )}
      >
        {justAdded ? "Added to bag" : "Add to bag"}
      </motion.button>

      {/*
        `aria-live` so the confirmation reaches a screen reader too — the
        button's own label changing is easy to miss, and the count in the
        header is nowhere near the focus. The blocked reason shares this line
        because the space is already reserved; a live region does not announce
        what it contains on first render, so it is read through
        `aria-describedby` instead, when the button is focused.
      */}
      <p id={hintId} aria-live="polite" className="min-h-[1.25rem] text-sm text-bone/60">
        {justAdded ? (
          <>
            Added.{" "}
            <Link
              href="/bag"
              className="text-bone underline underline-offset-4 transition-opacity hover:opacity-70"
            >
              View bag
            </Link>
          </>
        ) : blocked ? (
          blockedReason
        ) : null}
      </p>
    </div>
  );
}
