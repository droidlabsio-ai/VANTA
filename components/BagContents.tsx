"use client";

import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/data/types";
import { useEffect, useMemo } from "react";
import { useBag } from "@/components/BagProvider";
import { lineKey, resolveLine } from "@/lib/bagLine";
import { variantsOf } from "@/lib/variants";
import { backdropClass } from "@/lib/backdrops";
import { formatINR, cn } from "@/lib/format";
import { PincodeCheck } from "@/components/shipping/PincodeCheck";

/**
 * The bag's lines, resolved against the live catalogue.
 *
 * The catalogue arrives as a prop from the server page. The bag itself stores
 * only ids and quantities, so this is where a line becomes a name, a price and
 * a photograph — always today's, never the ones from the day it was added.
 *
 * Since §47 a line is a product *in a size*. A line saved before that has no
 * size; for a multi-size product it gets a size picker here, and checkout is
 * held until one is chosen. `soldOut` is every SKU at zero stock, read by the
 * server page, so a line that sold out since it was added says so here rather
 * than at the last step.
 */
export function BagContents({
  catalogue,
  soldOut = [],
}: {
  catalogue: Product[];
  soldOut?: string[];
}) {
  const { lines, changeQty, remove, clear, hydrated, pruneTo, droppedCount, setSize } = useBag();
  const soldOutSet = useMemo(() => new Set(soldOut), [soldOut]);

  // Memoised: it is a dependency of the pruning effect below, and a fresh
  // Map every render would re-run it every render.
  const byId = useMemo(() => new Map(catalogue.map((p) => [p.id, p])), [catalogue]);

  /**
   * A product can leave the catalogue while it sits in someone's bag — deleted
   * in the admin, or renamed to a new id. Those lines are dropped rather than
   * rendered as a blank row, and counted, so the page can say what happened
   * instead of silently showing a smaller bag than the badge promised.
   */
  const resolved = lines.flatMap((line) => {
    const product = byId.get(line.id);
    if (!product) return [];
    const resolution = resolveLine(product, line.sku);
    const key = lineKey(line);
    const isSoldOut = resolution.variant !== null && soldOutSet.has(resolution.variant.sku);
    return [{ line, product, resolution, key, unitPrice: resolution.unitPrice, isSoldOut }];
  });

  /** Lines checkout would refuse: no size chosen, or a size that has sold out. */
  const needsSize = resolved.filter(({ resolution }) => resolution.status !== "ok");
  const soldOutLines = resolved.filter(({ isSoldOut }) => isSoldOut);
  const blocked = needsSize.length > 0 || soldOutLines.length > 0;

  /**
   * Drop lines whose product has left the catalogue.
   *
   * The notice below says they have been removed, so they are removed — a
   * message describing something that did not happen is worse than no message.
   * It also keeps the header badge honest: it counts stored lines and cannot
   * see the catalogue, so leaving them would have it advertising items the bag
   * will never show.
   */
  useEffect(() => {
    if (!hydrated) return;
    pruneTo(new Set(byId.keys()));
    // `lines` is a trigger too: a bag changed in another tab is checked again.
  }, [hydrated, lines, byId, pruneTo]);

  /** Survives the prune, because the store reports what the prune removed. */
  const missingNotice = droppedCount;

  /** Counted from what is actually in the bag, never from unresolved lines. */
  const itemCount = resolved.reduce((total, { line }) => total + line.qty, 0);

  const subtotal = resolved.reduce((sum, { line, unitPrice }) => sum + unitPrice * line.qty, 0);
  const savings = resolved.reduce((sum, { line, product, unitPrice }) => {
    if (!product.compareAtPrice || product.compareAtPrice <= unitPrice) return sum;
    return sum + (product.compareAtPrice - unitPrice) * line.qty;
  }, 0);
  const allCod = resolved.length > 0 && resolved.every(({ product }) => product.codAvailable);

  // Until the stored bag has been read there is nothing true to show. An empty
  // state here would be wrong for anyone who does have a bag.
  if (!hydrated) {
    return <p className="py-16 text-sm text-bone/40">Loading your bag…</p>;
  }

  if (resolved.length === 0) {
    return (
      <div className="py-20">
        <p className="text-base text-bone/60">
          {missingNotice > 0
            ? "The items in your bag are no longer available."
            : "Your bag is empty."}
        </p>
        <Link
          href="/products"
          className="mt-4 inline-block text-label font-bold uppercase text-bone underline underline-offset-4 transition-opacity hover:opacity-70"
        >
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-12">
      <div>
        {missingNotice > 0 && (
          <p className="mb-6 border border-ink-line px-4 py-3 text-sm text-bone/60">
            {missingNotice} {missingNotice === 1 ? "item is" : "items are"} no longer available and
            {missingNotice === 1 ? " has" : " have"} been removed.
          </p>
        )}

        <ul className="divide-y divide-ink-line border-y border-ink-line">
          {resolved.map(({ line, product, resolution, key, unitPrice, isSoldOut }) => (
            <li key={key} className="flex gap-4 py-5">
              <Link
                href={product.href}
                className={cn(
                  "relative aspect-[3/4] w-20 shrink-0 overflow-hidden sm:w-24",
                  backdropClass[product.backdrop],
                )}
              >
                <Image
                  src={product.image.src}
                  alt={product.image.alt}
                  fill
                  sizes="96px"
                  className="object-cover object-center"
                />
              </Link>

              <div className="flex min-w-0 flex-1 flex-col">
                <Link href={product.href} className="text-sm font-medium text-bone hover:underline">
                  {product.name}
                </Link>
                {resolution.status === "ok" ? (
                  resolution.variant && variantsOf(product).length > 1 && (
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-bone/60">
                      Size {resolution.variant.size}
                    </p>
                  )
                ) : (
                  <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-flare-orange">
                    Choose a size
                    <select
                      value=""
                      onChange={(event) => event.target.value && setSize(key, event.target.value)}
                      className="border border-flare-orange/60 bg-ink px-2 py-1 text-xs text-bone"
                      aria-label={`Choose a size for ${product.name}`}
                    >
                      <option value="">Select</option>
                      {variantsOf(product).map((variant) => (
                        <option
                          key={variant.sku}
                          value={variant.sku}
                          disabled={soldOutSet.has(variant.sku)}
                        >
                          {variant.size}
                          {soldOutSet.has(variant.sku) ? " — sold out" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {isSoldOut && (
                  <p className="mt-1 text-xs font-semibold text-flare-orange">
                    Sold out — remove it to check out.
                  </p>
                )}
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-sm text-bone/80">{formatINR(unitPrice)}</span>
                  {product.compareAtPrice && product.compareAtPrice > unitPrice && (
                    <span className="text-xs text-bone/40 line-through">
                      {formatINR(product.compareAtPrice)}
                    </span>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
                  <div className="flex items-center border border-ink-line">
                    <button
                      type="button"
                      onClick={() => changeQty(key, -1)}
                      aria-label={`Decrease quantity of ${product.name}`}
                      className="px-3 py-1.5 text-bone/60 transition-colors hover:text-bone"
                    >
                      &minus;
                    </button>
                    {/* aria-live so a screen reader hears the new quantity
                        rather than only the button that changed it. */}
                    <span
                      aria-live="polite"
                      className="min-w-8 text-center text-sm tabular-nums text-bone"
                    >
                      {line.qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => changeQty(key, 1)}
                      aria-label={`Increase quantity of ${product.name}`}
                      className="px-3 py-1.5 text-bone/60 transition-colors hover:text-bone"
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(key)}
                    className="text-xs uppercase tracking-[0.12em] text-bone/40 underline underline-offset-4 transition-colors hover:text-bone"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <p className="shrink-0 text-sm tabular-nums text-bone">
                {formatINR(unitPrice * line.qty)}
              </p>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={clear}
          className="mt-4 text-xs uppercase tracking-[0.12em] text-bone/40 underline underline-offset-4 transition-colors hover:text-bone"
        >
          Empty bag
        </button>
      </div>

      <aside className="mt-10 lg:sticky lg:top-[calc(var(--header-h)+2rem)] lg:mt-0">
        <h2 className="eyebrow">Summary</h2>
        <dl className="mt-4 space-y-3 border-y border-ink-line py-5">
          <div className="flex justify-between gap-4 text-sm">
            <dt className="text-bone/60">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </dt>
            <dd className="tabular-nums text-bone">{formatINR(subtotal)}</dd>
          </div>
          {savings > 0 && (
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-bone/60">You save</dt>
              <dd className="tabular-nums text-flare-red">&minus;{formatINR(savings)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 text-sm">
            <dt className="text-bone/60">Delivery</dt>
            {/* Not computed. Saying "Free" here without a rule behind it would
                be a promise the site cannot keep. */}
            <dd className="text-bone/60">Calculated at checkout</dd>
          </div>
        </dl>

        <div className="flex items-baseline justify-between gap-4 py-4">
          <span className="text-label font-bold uppercase text-bone">Subtotal</span>
          <span className="text-lg tabular-nums text-bone">{formatINR(subtotal)}</span>
        </div>

        {/* The second place this is asked, and the last one before checkout.
            Someone who checked on a product page has it filled in already —
            the pincode is remembered in the browser. */}
        <PincodeCheck className="mb-4" valueRupees={subtotal} />

        {allCod && (
          <p className="mb-4 border border-bone/20 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-bone/50">
            Cash on delivery available
          </p>
        )}

        {/*
          Live now. §21 recorded this as deliberately inert because there was
          nowhere to send anyone; /checkout exists, so the honest thing is no
          longer a disabled label.
        */}
        {blocked ? (
          <>
            <p role="status" className="mb-3 text-xs font-semibold text-flare-orange">
              {needsSize.length > 0
                ? `Choose a size for ${needsSize.map(({ product }) => product.name).join(", ")} to check out.`
                : "Remove the sold-out items to check out."}
            </p>
            <span
              aria-disabled="true"
              className="block w-full cursor-not-allowed rounded-full bg-bone/30 px-8 py-4 text-center text-label-lg font-bold uppercase text-ink"
            >
              Checkout
            </span>
          </>
        ) : (
          <Link
            href="/checkout"
            className="block w-full rounded-full bg-bone px-8 py-4 text-center text-label-lg font-bold uppercase text-ink transition-colors hover:bg-white"
          >
            Checkout
          </Link>
        )}

        <Link
          href="/products"
          className="mt-4 block text-center text-xs uppercase tracking-[0.12em] text-bone/50 underline underline-offset-4 transition-colors hover:text-bone"
        >
          Continue shopping
        </Link>
      </aside>
    </div>
  );
}
