"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ProductVariant } from "@/data/types";
import { AddToBagButton } from "@/components/AddToBagButton";
import { cn, formatINR } from "@/lib/format";
import {
  listPriceLabel,
  priceSummary,
  variantPrice,
  type StockStatus,
} from "@/lib/variants";

/**
 * The size a shopper has chosen on the product page, and the two things that
 * depend on it: the price shown, and whether Add to Bag can be pressed.
 *
 * A provider with small consumers rather than one component owning the whole
 * buy box, for §13's reason. The price sits above the description and the
 * picker below it; one client component spanning both would drag the
 * server-rendered description, the save button and the pincode check into the
 * client tree for nothing. This renders no DOM of its own — the page stays a
 * server shell, and only the leaves that read the selection hydrate.
 *
 * ## Hydration
 *
 * The selection starts as `null` on the server and in the browser, always.
 * There is no stored value to read. That is the difference from the bag (§21),
 * whose server snapshot had to be an empty list because only the browser knows
 * what is in localStorage — here the server's no-selection markup and the
 * browser's first render are identical by construction, not by care. Nothing
 * in this tree may read the URL, storage or the clock during render; doing that
 * is exactly how §21's mismatch happened.
 *
 * **The chosen size does not reach the bag yet.** Add to Bag still adds the
 * product, not the size, because the bag stores product ids only until stage 3
 * changes it. The selection is held here, keyed by SKU, ready for that.
 */

interface Selection {
  variants: readonly ProductVariant[];
  selectedSku: string | null;
  /** The size in effect: the one picked, or the only one when there is one. */
  chosen: ProductVariant | null;
  select: (sku: string) => void;
  isSoldOut: (sku: string) => boolean;
  /** Why Add to Bag cannot be pressed yet, or null when it can. */
  blockedReason: string | null;
  /** The picker's radio group, so a blocked Add to Bag can send focus there. */
  pickerRef: React.RefObject<HTMLDivElement | null>;
  price: number;
  compareAtPrice?: number;
}

const SelectionContext = createContext<Selection | null>(null);

export function useVariantSelection(): Selection {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useVariantSelection must be used inside <VariantSelectionProvider>");
  return ctx;
}

export function VariantSelectionProvider({
  price,
  compareAtPrice,
  variants,
  stock,
  children,
}: {
  /** Whole rupees — the product's price, which a size without its own inherits. */
  price: number;
  compareAtPrice?: number;
  variants: readonly ProductVariant[];
  /** From `lib/stock.ts`, on the server. */
  stock: Record<string, StockStatus>;
  children: React.ReactNode;
}) {
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const isSoldOut = useCallback((sku: string) => stock[sku] === "sold-out", [stock]);

  // A sold-out size is shown but cannot be chosen — by click, key or anything else.
  const select = useCallback(
    (sku: string) => {
      if (!isSoldOut(sku)) setSelectedSku(sku);
    },
    [isSoldOut],
  );

  const value = useMemo<Selection>(() => {
    /**
     * One size is chosen by default because there is nothing to choose — every
     * bag is "One Size", and asking someone to pick from one option is a step
     * that teaches them nothing. Several sizes are never pre-chosen: pre-picking
     * M is how somebody buys the wrong size without noticing.
     */
    const chosen =
      variants.length === 1
        ? variants[0]
        : (variants.find((v) => v.sku === selectedSku) ?? null);

    /**
     * No variants at all is a published document from before sizes existed —
     * see `variantsOf`. It behaves as the page always did: nothing blocks.
     */
    const blockedReason =
      variants.length === 0
        ? null
        : chosen
          ? isSoldOut(chosen.sku)
            ? "Sold out"
            : null
          : variants.every((v) => isSoldOut(v.sku))
            ? "Sold out"
            : "Select a size";

    return {
      variants,
      selectedSku,
      chosen,
      select,
      isSoldOut,
      blockedReason,
      pickerRef,
      price,
      compareAtPrice,
    };
  }, [variants, selectedSku, select, isSoldOut, price, compareAtPrice]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/**
 * The price, as it stands for the current selection.
 *
 * Before a choice: `listPriceLabel` — a plain price, or "From" the cheapest
 * size only when sizes genuinely cost different amounts. After: the chosen
 * size's actual price. Both come from `lib/variants.ts`, the same helper the
 * product cards use, so the page and the card it was clicked from cannot
 * disagree.
 *
 * `aria-live` because the figure can change in response to choosing a size,
 * and that change happens away from the focus. When every size costs the same
 * — every product today — the text never changes, so nothing is announced.
 */
export function VariantPrice({ className }: { className?: string }) {
  const { chosen, price, compareAtPrice, variants } = useVariantSelection();
  const product = { price, variants };
  const shown = chosen ? variantPrice(product, chosen) : priceSummary(product).lowest;
  const label = chosen ? formatINR(shown) : listPriceLabel(product);

  const onSale = compareAtPrice !== undefined && compareAtPrice > shown;
  const savedPct = onSale ? Math.round(((compareAtPrice - shown) / compareAtPrice) * 100) : 0;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn("flex flex-wrap items-baseline gap-3", className)}
    >
      <span className="text-2xl text-bone">{label}</span>
      {onSale && (
        <>
          <span className="text-base text-bone/40 line-through">{formatINR(compareAtPrice)}</span>
          <span className="bg-flare-red px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-bone">
            {savedPct}% off
          </span>
        </>
      )}
    </div>
  );
}

/** Add to Bag, blocked until a size is chosen, with the reason shown beside it. */
export function VariantAddToBag({ productId }: { productId: string }) {
  const { blockedReason, pickerRef } = useVariantSelection();
  return (
    <AddToBagButton
      productId={productId}
      blockedReason={blockedReason}
      // Pressing it without a size takes you to the thing that fixes that.
      onBlockedClick={() =>
        pickerRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus()
      }
    />
  );
}
