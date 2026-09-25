import Link from "next/link";
import type { Product, ProductRailContent } from "@/data/types";
import { fadeUpSm } from "@/lib/motion";
import { RevealHeadline } from "@/components/scroll/RevealHeadline";
import { ProductCard } from "@/components/ProductCard";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";

interface ProductRailProps {
  content: ProductRailContent;
  products: Product[];
}

/**
 * Server component. Mobile: horizontal scroll-snap rail (pure CSS). Desktop:
 * auto-fit grid. Cards stagger in via the `RevealGroup` wrappers.
 */
export function ProductRail({ content, products }: ProductRailProps) {
  return (
    <section className="py-section lg:py-section-lg">
      {/* Header */}
      <RevealGroup
        staggerChildren={0.08}
        className="flex items-end justify-between gap-6 px-gutter lg:mx-auto lg:max-w-container lg:px-gutter-lg"
      >
        <RevealHeadline
          lines={content.headline}
          className="text-display-sm text-bone lg:text-display-md"
        />

        <RevealItem variants={fadeUpSm} className="shrink-0 pb-2">
          <Link
            href={content.viewAll.href}
            className="group inline-flex items-center gap-2 text-label font-bold uppercase text-bone/60 transition-colors duration-200 ease-in-out hover:text-bone"
          >
            {content.viewAll.label}
            <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 ease-in-out group-hover:translate-x-1" />
          </Link>
        </RevealItem>
      </RevealGroup>

      {/* Cards. On desktop, auto-fit keeps the grid balanced for any number of
          products rather than a fixed column count that orphans the last card. */}
      <RevealGroup
        staggerChildren={0.07}
        delayChildren={0.05}
        className="snap-rail mt-10 gap-3 px-gutter lg:mx-auto lg:grid lg:max-w-container lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] lg:gap-6 lg:overflow-visible lg:px-gutter-lg"
      >
        {products.map((product, i) => (
          <RevealItem
            key={product.id}
            className="snap-item-start w-[70vw] sm:w-[45vw] lg:w-auto"
          >
            {/* Cards lift at slightly different rates so the row has depth. */}
            <div data-depth={i % 2 === 0 ? 0.35 : 0.15}>
              {/* Its own layer: the parallax above moves `y` too, and two
                  tweens on one element's `y` would overwrite each other. */}
              <div data-rise>
                <ProductCard product={product} />
              </div>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  );
}
