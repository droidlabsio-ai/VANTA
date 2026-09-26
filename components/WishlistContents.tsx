"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import type { Product } from "@/data/types";
import { useWishlist } from "@/components/WishlistProvider";
import { useBag } from "@/components/BagProvider";
import { onlySku } from "@/lib/bagLine";
import { ProductCard } from "@/components/ProductCard";

/**
 * The wishlist, resolved against the live catalogue.
 *
 * Same shape as the bag's contents and for the same reasons: the list holds
 * ids, the catalogue arrives from the server, and lines whose product has
 * gone are pruned rather than rendered blank.
 *
 * Rendered with the same `ProductCard` the listing pages use, so a saved item
 * looks exactly like it did where it was saved — including its own save
 * button, which is how it gets removed.
 */
export function WishlistContents({ catalogue }: { catalogue: Product[] }) {
  const { ids, hydrated, pruneTo, droppedCount, clear } = useWishlist();
  const { add } = useBag();

  const byId = useMemo(() => new Map(catalogue.map((p) => [p.id, p])), [catalogue]);

  const saved = useMemo(
    () => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    [ids, byId],
  );

  /** Drop ids whose product has left the catalogue. See the bag for the why. */
  useEffect(() => {
    if (!hydrated) return;
    pruneTo(new Set(byId.keys()));
  }, [hydrated, ids, byId, pruneTo]);

  if (!hydrated) {
    return <p className="py-16 text-sm text-bone/40">Loading your wishlist…</p>;
  }

  if (saved.length === 0) {
    return (
      <div className="py-20">
        <p className="text-base text-bone/60">
          {droppedCount > 0
            ? "The items you saved are no longer available."
            : "You haven’t saved anything yet."}
        </p>
        <p className="mt-2 max-w-prose text-sm text-bone/40">
          Tap the heart on any product to keep it here.
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

  const allAvailable = saved.filter((p) => p.codAvailable !== undefined);

  return (
    <div>
      {droppedCount > 0 && (
        <p className="mb-6 border border-ink-line px-4 py-3 text-sm text-bone/60">
          {droppedCount} {droppedCount === 1 ? "item is" : "items are"} no longer available and
          {droppedCount === 1 ? " has" : " have"} been removed.
        </p>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-ink-line pb-4">
        <p className="text-sm text-bone/50">
          {saved.length} {saved.length === 1 ? "piece" : "pieces"}
        </p>
        <div className="flex items-center gap-4">
          {/*
            Adds everything without emptying the wishlist. Saving is a
            long-lived intent — someone moving a whole list into the bag has
            not decided to stop wanting those things.
          */}
          <button
            type="button"
            onClick={() => allAvailable.forEach((p) => add(p.id, onlySku(p)))}
            className="text-label font-bold uppercase text-bone underline underline-offset-4 transition-opacity hover:opacity-70"
          >
            Add all to bag
          </button>
          <button
            type="button"
            onClick={clear}
            className="text-xs uppercase tracking-[0.12em] text-bone/40 underline underline-offset-4 transition-colors hover:text-bone"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
        {saved.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          />
        ))}
      </div>
    </div>
  );
}
