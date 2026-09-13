"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/format";
import { useVariantSelection } from "@/components/product/VariantSelection";

/**
 * Choosing a size.
 *
 * **A set of radio buttons, built as one.** `role="radiogroup"` named by the
 * visible "Size" label, and every option a `role="radio"` whose checked state is
 * exposed as `aria-checked` — not only drawn inverted. Keyboard behaviour is the
 * ARIA radio-group pattern: the group is a single Tab stop (the chosen size, or
 * the first available one when nothing is chosen yet), arrow keys move between
 * sizes and choose as they go, Home and End jump to the ends, and Space or
 * Enter choose the focused size.
 *
 * Buttons with ARIA roles rather than native `<input type="radio">`, and the
 * reason is hydration rather than taste. A native radio can be clicked in the
 * moment between the server HTML arriving and React hydrating; the browser
 * checks it, and React then hydrates with nothing selected — the page shows a
 * chosen size while Add to Bag still says to choose one. A button does nothing
 * at all until it is interactive, which is honest.
 *
 * **Tabbing lands on a size without choosing it.** Nothing is chosen until the
 * shopper acts. Pre-picking M is how somebody buys the wrong size.
 *
 * **Sold-out sizes are shown, dimmed and crossed out, and cannot be chosen.**
 * Hiding them would make a size run look like the product was never made in
 * XL. They are `aria-disabled` rather than `disabled`, so a screen reader in
 * browse mode still reaches them and hears "XL — sold out"; arrow keys skip
 * them, as the radio-group pattern specifies. Nothing is sold out today — see
 * `lib/stock.ts` — but the state is built and driven from there.
 *
 * Accessible names follow §11. Each option's name is its visible text, and
 * "sold out" is appended as `sr-only` text inside one template string — not as
 * an `aria-label`, which would replace the visible label instead of extending
 * it. The focus ring is the site-wide `:focus-visible` rule in `globals.css`,
 * bone on ink, deliberately not restated here.
 *
 * A product with one size (every bag) or none renders nothing: there is no
 * choice to offer, and Add to Bag works without one.
 */

const STEP: Partial<Record<string, 1 | -1 | "first" | "last">> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  Home: "first",
  End: "last",
};

export function SizePicker({ className }: { className?: string }) {
  const { variants, selectedSku, select, isSoldOut, pickerRef } = useVariantSelection();
  const labelId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  if (variants.length <= 1) return null;

  const available = variants.flatMap((v, i) => (isSoldOut(v.sku) ? [] : [i]));
  const selectedIndex = variants.findIndex((v) => v.sku === selectedSku);
  const tabStop = selectedIndex >= 0 ? selectedIndex : (available[0] ?? -1);
  const anySoldOut = available.length < variants.length;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    /**
     * Space and Enter choose the focused size, handled here rather than left to
     * the button's native activation. `role="radio"` promises Space-to-select
     * (the ARIA radio pattern), and that promise belongs to this component — it
     * should not hold only because the element happens to be a `<button>`.
     * `select` ignores sold-out sizes, so this cannot choose one either.
     */
    if (e.key === "Enter" || e.key === " ") {
      const i = Number((e.target as HTMLElement).dataset.index);
      if (Number.isInteger(i) && variants[i]) {
        e.preventDefault();
        select(variants[i].sku);
      }
      return;
    }

    const step = STEP[e.key];
    if (step === undefined || available.length === 0) return;
    e.preventDefault();

    const from = available.indexOf(Number((e.target as HTMLElement).dataset.index));
    const last = available.length - 1;
    const next =
      step === "first"
        ? available[0]
        : step === "last"
          ? available[last]
          : from === -1
            ? available[step === 1 ? 0 : last]
            : available[(from + step + available.length) % available.length];

    buttons.current[next]?.focus();
    select(variants[next].sku);
  };

  return (
    <div className={className}>
      <p id={labelId} className="eyebrow">
        Size
      </p>

      <div
        ref={pickerRef}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="mt-3 flex flex-wrap gap-2"
      >
        {variants.map((variant, i) => {
          const checked = i === selectedIndex;
          const soldOut = isSoldOut(variant.sku);
          return (
            <button
              key={variant.sku}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={soldOut || undefined}
              tabIndex={i === tabStop ? 0 : -1}
              data-index={i}
              onClick={() => select(variant.sku)}
              className={cn(
                // 44px tall: comfortably above the 24px WCAG 2.5.8 minimum for
                // a control someone is choosing with a thumb.
                "relative inline-flex h-11 min-w-[2.75rem] items-center justify-center overflow-hidden border px-3 text-sm tabular-nums transition-colors duration-150 ease-in-out",
                soldOut
                  ? "cursor-not-allowed border-bone/15 text-bone/35"
                  : checked
                    ? "border-bone bg-bone text-ink"
                    : // bone/40 on ink is 3.58:1 — over the 3:1 WCAG 1.4.11
                      // asks of a control's boundary (§29).
                      "border-bone/40 text-bone hover:border-bone",
              )}
            >
              {variant.size}
              {soldOut && (
                <>
                  <span className="sr-only normal-case">{` — sold out`}</span>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[150%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-bone/35"
                  />
                </>
              )}
            </button>
          );
        })}
      </div>

      {anySoldOut && (
        <p className="mt-2 text-xs text-bone-faint">Crossed-out sizes are sold out.</p>
      )}
    </div>
  );
}
