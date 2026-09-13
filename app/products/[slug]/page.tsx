import type { Metadata } from "next";
import type { Product } from "@/data/types";
import { pageMetadata } from "@/lib/seo";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { contentStore } from "@/lib/contentStore";
import { getAllProductIds, getProduct, getRelated } from "@/lib/catalogue";
import { backdropClass } from "@/lib/backdrops";
import { formatINR } from "@/lib/format";
import { siteUrl, siteUrlIsPlaceholder } from "@/lib/siteUrl";
import { priceSummary, variantsOf } from "@/lib/variants";
import { stockStatus } from "@/lib/stock";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BottomNav } from "@/components/BottomNav";
import { ProductCard } from "@/components/ProductCard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { SizePicker } from "@/components/product/SizePicker";
import {
  VariantAddToBag,
  VariantPrice,
  VariantSelectionProvider,
} from "@/components/product/VariantSelection";
import { PincodeCheck } from "@/components/shipping/PincodeCheck";
import { SaveButton } from "@/components/SaveButton";
import { trustIcons } from "@/components/ui/Icons";

export async function generateStaticParams() {
  return (await getAllProductIds()).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: "Not found" };

  const { homepage } = await contentStore.read();
  const category = homepage.categories.items.find((c) => c.id === product.categoryId);

  return pageMetadata({
    title: product.name,
    /**
     * Built from the product, not from `product.image.alt`.
     *
     * The alt text was the description until now, and it describes the
     * *photograph* — "technical shell jacket on a red backdrop" — of a
     * stand-in image at that (§12). It named neither the garment, the category
     * nor the price, which are the three things somebody scanning a search
     * result is actually deciding on.
     *
     * The price is the live one, so it matches the page and the Product
     * JSON-LD. It stays correct because publishing revalidates this route.
     */
    description: describeProduct(product, category?.name),
    path: `/products/${product.id}`,
  });
}

/** Kept out of `generateMetadata` so the shape of the sentence is readable. */
function describeProduct(product: Product, categoryName: string | undefined): string {
  const where = categoryName ? `${categoryName.toLowerCase()} from VANTA` : "from VANTA";
  /**
   * The closing clause differs by whether COD is offered, and both branches are
   * written to land the whole sentence in the 140–160 range — measured, not
   * guessed. The no-COD branch was 131 characters when it simply omitted the
   * clause, which reads as a truncated thought in a result list.
   */
  const close = product.codAvailable
    ? "Cash on delivery available, free shipping over ₹1,999."
    : "Free shipping over ₹1,999, with seven-day returns.";
  /**
   * The price as the page states it before a size is chosen: "from" the
   * cheapest size only when sizes genuinely cost different amounts. Answered by
   * `priceSummary` — the same helper as the page and every card — so the search
   * result cannot quote a price the page does not show.
   */
  const { lowest, varies } = priceSummary(product);
  const price = `${varies ? "from " : ""}${formatINR(lowest)}`;
  return `${product.name} — ${where}, ${price}. Technical streetwear built for the Indian street. ${close}`;
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  /**
   * Through `variantsOf`, never `product.variants` directly. A published
   * document from before sizes existed has no such key, and this page has to
   * keep rendering on every site that published one — see the comment there.
   */
  const variants = variantsOf(product);

  const [{ homepage }, related, stock] = await Promise.all([
    contentStore.read(),
    getRelated(product),
    stockStatus(variants),
  ]);

  const category = homepage.categories.items.find((c) => c.id === product.categoryId);
  const prices = priceSummary(product);
  const offerUrl = `${siteUrl}/products/${product.id}`;

  /**
   * Whether anything can be bought, from the same stock helper the size picker
   * reads — so when stock exists, the structured data and the buttons change
   * together. A product with no variant data behaves as it always did.
   */
  const buyable = variants.length === 0 || variants.some((v) => stock[v.sku] !== "sold-out");

  /**
   * `Product` + `Offer` structured data.
   *
   * `Offer` is the half that earns its place: it is what carries price,
   * currency and availability into a search result. `Product` alone tells a
   * crawler the page is about a garment and nothing a shopper decides on.
   *
   * Omitted when the site URL is a placeholder, for the reason
   * `components/Breadcrumbs.tsx` gives about `BreadcrumbList`: `image` and
   * `offers.url` have to be absolute, and publishing `http://localhost:3000/…`
   * as a machine-readable claim about where this product lives is worse than
   * publishing nothing. The visible page is unaffected either way.
   *
   * **The description is `describeProduct`, the same call `generateMetadata`
   * makes.** `Product` has no description field, so this sentence is composed;
   * composing it twice would be two descriptions of one garment, free to
   * drift, and the meta description is the one a person reads in the result
   * this markup is decorating. It is deliberately not `product.image.alt` —
   * that describes the *photograph*, and a stand-in photograph at that. See
   * the comment in `generateMetadata` and `lib/seo.ts`.
   *
   * `sku` is `product.id` because that is exactly what
   * `lib/shipping/courierPush.ts` sends Shiprocket as the SKU. One identifier
   * for this garment everywhere it is named to somebody outside.
   *
   * **No `aggregateRating`.** There are no reviews in this codebase, and
   * inventing a rating is a Google manual action — a fabricated star count is
   * one of the things they penalise a whole site for, not just a page. It goes
   * in when reviews exist and are real.
   */
  const productLd = siteUrlIsPlaceholder
    ? null
    : {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        image: `${siteUrl}${product.image.src}`,
        description: describeProduct(product, category?.name),
        sku: product.id,
        brand: { "@type": "Brand", name: "VANTA" },
        /**
         * Prices are whole **rupees** — the catalogue's unit for products and
         * sizes alike, not the paise every stored money column uses (§26).
         * schema.org wants a decimal string in major units, so they are
         * formatted directly and must never be routed through `formatPaise` or
         * `paiseToRupees`: the failure mode is a price wrong by a factor of a
         * hundred, published to a search engine.
         *
         * When sizes cost different amounts there is no single price to state,
         * so an `AggregateOffer` carries the range. A plain `Offer` at the
         * product's base price would publish a figure no size may actually sell
         * for, and structured data has to match what the page shows. Which of
         * the two applies is `priceSummary`'s answer, the page's and the
         * cards'.
         *
         * Availability comes from the stock helper rather than being written
         * in. There is no stock yet, so it reads in stock; when stock lands,
         * this follows the buttons instead of contradicting them — a hard-coded
         * `InStock` over a sold-out product is the structured-data mistake
         * Google acts on, and it would be invisible on the page.
         */
        offers: prices.varies
          ? {
              "@type": "AggregateOffer",
              url: offerUrl,
              priceCurrency: "INR",
              lowPrice: prices.lowest.toFixed(2),
              highPrice: prices.highest.toFixed(2),
              offerCount: variants.length,
              availability: buyable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            }
          : {
              "@type": "Offer",
              url: offerUrl,
              priceCurrency: "INR",
              price: prices.lowest.toFixed(2),
              availability: buyable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            },
      };

  return (
    <div className="storefront-shell">
      {productLd && <JsonLd data={productLd} />}
      <Navbar nav={homepage.nav} />

      <main id="main" className="pt-[calc(var(--header-h)+2rem)]">
        <div className="lg:grid lg:grid-cols-2 lg:gap-12 lg:px-gutter-lg xl:gap-16">
          <div className={`relative aspect-[3/4] w-full overflow-hidden ${backdropClass[product.backdrop]}`}>
            <Image
              src={product.image.src}
              alt={product.image.alt}
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover object-center"
            />
            {product.badge && (
              <span className="absolute left-0 top-0 bg-bone px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-ink">
                {product.badge}
              </span>
            )}
          </div>

          <div className="px-gutter py-8 lg:px-0 lg:py-0 lg:self-center">
            {/* Visible trail and BreadcrumbList JSON-LD from one array, so
                the markup cannot disagree with what is on screen. */}
            <Breadcrumbs
              trail={[
                { name: "Home", href: "/" },
                ...(category ? [{ name: category.name, href: category.href }] : []),
                { name: product.name },
              ]}
            />

            <h1 className="headline mt-4 text-display-sm lg:text-[3rem] lg:leading-[0.9]">
              {product.name}
            </h1>

            {/* The price, the size picker and Add to Bag share one selection.
                The provider renders no DOM of its own: the description and the
                save button between them stay server-rendered, and only the
                three leaves that read the selection are client components. */}
            <VariantSelectionProvider
              price={product.price}
              compareAtPrice={product.compareAtPrice}
              variants={variants}
              stock={stock}
            >
              <VariantPrice className="mt-5" />

              <p className="mt-6 max-w-prose whitespace-pre-line text-base leading-relaxed text-bone/70">
                {product.image.alt}
              </p>

              <SizePicker className="mt-8" />

              <div className="mt-8 flex flex-wrap items-start gap-3">
                <VariantAddToBag productId={product.id} />
                <SaveButton productId={product.id} productName={product.name} />
              </div>
            </VariantSelectionProvider>

            {/* Before the bag, not after checkout. The two things that decide
                whether this is worth buying are whether it reaches them and
                when — asking at the last step of checkout is too late. */}
            <PincodeCheck className="mt-6" valueRupees={product.price} />

            {/* The buying facts, in the same spec-sheet register as the rest
                of the site. Only the ones this product actually carries. */}
            <dl className="mt-8 divide-y divide-ink-line border-y border-ink-line">
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="eyebrow">Cash on delivery</dt>
                <dd className="text-sm text-bone/80">
                  {product.codAvailable ? "Available" : "Not available"}
                </dd>
              </div>
              {category && (
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="eyebrow">Category</dt>
                  <dd className="text-sm text-bone/80">
                    <Link href={category.href} className="underline underline-offset-4 hover:text-bone">
                      {category.name}
                    </Link>
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="eyebrow">Reference</dt>
                <dd className="text-sm uppercase tracking-[0.1em] text-bone/80">{product.id}</dd>
              </div>
            </dl>

            <ul className="mt-6 space-y-3">
              {homepage.trust.items.slice(0, 3).map((item) => {
                const Icon = trustIcons[item.icon];
                return (
                  <li key={item.id} className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-bone/50" />
                    <span className="text-sm text-bone/60">
                      <span className="text-bone/80">{item.title}</span> — {item.detail}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {related.length > 0 && (
          <section className="px-gutter py-16 lg:px-gutter-lg lg:py-24">
            <h2 className="headline text-display-sm">More in {category?.name ?? "this range"}</h2>
            {/* Plain, for the same reason as the collection grid: products
                must not depend on hydration to be visible. */}
            <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
              {related.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                />
              ))}
            </div>
          </section>
        )}
      </main>

      <Footer content={homepage.footer} />
      <BottomNav items={homepage.nav.bottomNav} />
    </div>
  );
}
