import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/data/types";
import { backdropClass } from "@/lib/backdrops";
import { formatINR, cn } from "@/lib/format";
import { listPriceLabel, priceSummary } from "@/lib/variants";
import { SaveButton } from "@/components/SaveButton";

interface ProductCardProps {
  product: Product;
  /** Sizes hint differs between the mobile rail and the desktop grid. */
  sizes?: string;
}

/**
 * Server component — nothing here needs JS. The hover zoom is a CSS transition,
 * and the scroll reveal comes from the `RevealItem` the rail wraps it in.
 *
 * `motion-safe` on the hover scale matters beyond accessibility: on touch
 * devices `:hover` can stick after a tap, leaving a card permanently zoomed.
 *
 * No size picker here — there is no room for one, and a card's job is to get
 * someone to the product page, where sizes are chosen. It shows one price,
 * answered by the same helper the product page uses.
 */
export function ProductCard({ product, sizes = "(min-width: 1024px) 25vw, 70vw" }: ProductCardProps) {
  // The cheapest size — which, for every product today, is simply the price.
  const { lowest } = priceSummary(product);

  return (
    <article className="h-full">
      <Link href={product.href} className="group flex h-full flex-col">
        <div
          className={cn(
            "relative aspect-[3/4] w-full overflow-hidden",
            backdropClass[product.backdrop],
          )}
        >
          <Image
            src={product.image.src}
            alt={product.image.alt}
            fill
            loading="lazy"
            sizes={sizes}
            className="object-cover object-center transition-transform duration-500 ease-in-out motion-safe:group-hover:scale-105"
          />

          <SaveButton productId={product.id} productName={product.name} overlay />

          {product.badge && (
            <span className="absolute left-0 top-0 bg-bone px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-ink">
              {product.badge}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-1 flex-col">
          <h3 className="text-sm font-medium text-bone">{product.name}</h3>

          <div className="mt-1 flex items-baseline gap-2">
            {/* "From" only when sizes genuinely cost different amounts. */}
            <span className="text-sm text-bone">{listPriceLabel(product)}</span>
            {product.compareAtPrice && product.compareAtPrice > lowest && (
              <span className="text-xs text-bone/40 line-through">
                {formatINR(product.compareAtPrice)}
              </span>
            )}
          </div>

          {product.codAvailable && (
            <span className="mt-2 self-start border border-bone/20 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-bone/50">
              COD Available
            </span>
          )}
        </div>
      </Link>
    </article>
  );
}
