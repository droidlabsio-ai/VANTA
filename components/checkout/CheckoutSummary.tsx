"use client";

import Image from "next/image";
import Link from "next/link";
import { useBag } from "@/components/BagProvider";
import { lineKey, resolveLine } from "@/lib/bagLine";
import { backdropClass } from "@/lib/backdrops";
import { formatINR, cn } from "@/lib/format";
import type { Product } from "@/data/types";

/**
 * The order summary beside the checkout form.
 *
 * A client component for one reason: the bag is in `localStorage`, so the
 * server cannot know what is in it. The catalogue arrives as a prop, priced by
 * the server, and this only resolves ids against it — exactly as the bag page
 * does.
 *
 * The totals shown here are **not** what gets charged. `createOrder` prices the
 * bag again from the catalogue at the moment of submission, so a price changed
 * between this render and that click is caught rather than honoured. This is a
 * preview; the server has the last word.
 */
export function CheckoutSummary({ catalogue }: { catalogue: Product[] }) {
  const { lines, hydrated } = useBag();
  const byId = new Map(catalogue.map((p) => [p.id, p]));

  const resolved = lines.flatMap((line) => {
    const product = byId.get(line.id);
    if (!product) return [];
    const resolution = resolveLine(product, line.sku);
    return [{ line, product, resolution, key: lineKey(line), unitPrice: resolution.unitPrice }];
  });

  const subtotal = resolved.reduce((sum, { line, unitPrice }) => sum + unitPrice * line.qty, 0);
  const needsSize = resolved.filter(({ resolution }) => resolution.status !== "ok");
  const missing = lines.length - resolved.length;

  if (!hydrated) {
    return <p className="py-8 text-sm text-bone/40">Loading your bag…</p>;
  }

  if (resolved.length === 0) {
    return (
      <div className="py-8">
        <p className="text-sm text-bone/60">Your bag is empty.</p>
        <Link
          href="/products"
          className="mt-3 inline-block text-label font-bold uppercase text-bone underline underline-offset-4"
        >
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div>
      {missing > 0 && (
        <p className="mb-4 border border-flare-orange/40 px-3 py-2 text-xs text-flare-orange">
          {missing} {missing === 1 ? "item is" : "items are"} no longer available and{" "}
          {missing === 1 ? "has" : "have"} been left out.
        </p>
      )}

      {needsSize.length > 0 && (
        <p className="mb-4 border border-flare-orange/40 px-3 py-2 text-xs text-flare-orange">
          Choose a size for {needsSize.map(({ product }) => product.name).join(", ")} in{" "}
          <Link href="/bag" className="underline underline-offset-2">
            your bag
          </Link>{" "}
          before placing the order.
        </p>
      )}

      <ul className="divide-y divide-ink-line border-y border-ink-line">
        {resolved.map(({ line, product, resolution, key, unitPrice }) => (
          <li key={key} className="flex gap-3 py-3">
            <div
              className={cn(
                "relative aspect-[3/4] w-14 shrink-0 overflow-hidden",
                backdropClass[product.backdrop],
              )}
            >
              <Image src={product.image.src} alt="" fill sizes="56px" className="object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-bone">{product.name}</p>
              <p className="text-xs text-bone/40">
                {resolution.variant ? `Size ${resolution.variant.size} · ` : ""}Qty {line.qty}
              </p>
            </div>
            <p className="shrink-0 text-sm tabular-nums text-bone">
              {formatINR(unitPrice * line.qty)}
            </p>
          </li>
        ))}
      </ul>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-bone/60">Subtotal</dt>
          <dd className="tabular-nums text-bone">{formatINR(subtotal)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-bone/60">Delivery</dt>
          {/* Zero because there is no shipping engine, not because delivery is
              free. Saying "Free" would be a promise with no rule behind it. */}
          <dd className="text-bone/60">Calculated later</dd>
        </div>
      </dl>

      <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-ink-line pt-4">
        <span className="text-label font-bold uppercase text-bone">Total</span>
        <span className="text-lg tabular-nums text-bone">{formatINR(subtotal)}</span>
      </div>
    </div>
  );
}
