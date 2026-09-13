import type { ProductVariant } from "@/data/types";
import { formatINR } from "@/lib/format";

/**
 * Sizes, the SKUs that identify them, and what they cost.
 *
 * **Client-safe on purpose** — no `import "server-only"`. The seed was generated
 * from these functions, the storefront's size picker runs in the browser, and
 * the admin's variant editor (a later stage) has to produce the same values
 * from a draft. Same split as `lib/categoryCounts.ts` (§30): the rule is
 * shared, the I/O is not. Stock, which *is* I/O, lives in `lib/stock.ts`.
 */

const APPAREL = ["S", "M", "L", "XL"] as const;

/**
 * Which sizes a product is sold in, by the category it belongs to.
 *
 * **The only place size sets are defined.** One product has one `categoryId`
 * (§19), so its sizes follow from where it is filed rather than being chosen
 * per product — nobody has to remember that trousers are sized by waist.
 *
 * Keyed by `Category.id`, and those are data: an editor can create a category
 * in `/admin`, and it will have no entry here until one is added. The groups
 * (`clothing`, `accessories` — §22) have none either, because a product filed
 * directly under a group is not something this catalogue does. `sizesFor`
 * returns `undefined` for all of those rather than guessing a set.
 */
export const SIZE_SETS: Readonly<Record<string, readonly string[]>> = {
  jackets: APPAREL,
  parkas: APPAREL,
  tops: APPAREL,
  pants: ["28", "30", "32", "34", "36", "38"],
  bags: ["One Size"],
};

export function sizesFor(categoryId: string): readonly string[] | undefined {
  return SIZE_SETS[categoryId];
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** First letter, then the following consonants, without doubles, capped at `max`. */
function skeleton(word: string, max: number): string {
  let out = word[0] ?? "";
  for (const c of word.slice(1)) {
    if (out.length === max) break;
    if (!VOWELS.has(c) && c !== out.at(-1)) out += c;
  }
  return out;
}

/**
 * The short, stable code for a product, derived from its id.
 *
 * The first word's consonant skeleton (`apex` → `APX`), then the initial of
 * every later word (`technical-shell` → `TS`), with any word containing a digit
 * kept whole (`026`, `40l`), because in this catalogue the number is what tells
 * `grid-bomber-04` from the next drop.
 *
 * **Why not just the first word.** That is the shortest thing that reads well,
 * and against the current 45 ids it produces nine collisions — four products
 * start with `grid`, and `vector-storm-shell` and `vector-cargo-pant` share
 * every letter it would use. No function of the first word alone can separate
 * them. This rule was chosen by running candidates against the real catalogue,
 * and it is collision-free across all 45.
 *
 * **Collision-free is a fact about today's ids, not a guarantee.** A future
 * `vector-storm-shield` would produce the same code as `vector-storm-shell`.
 * Uniqueness is actually enforced at publish, across the whole catalogue, by
 * `lib/contentSchema.ts` — this function only makes the common case right.
 */
export function productCode(productId: string): string {
  const words = productId
    .toLowerCase()
    .split("-")
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  const [head, ...rest] = words;
  if (!head) return "";
  return (skeleton(head, 3) + rest.map((w) => (/\d/.test(w) ? w : w[0])).join("")).toUpperCase();
}

/** `M` → `M`, `One Size` → `ONESIZE`. Letters and digits only. */
function sizeCode(size: string): string {
  return size.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * `apex-technical-shell` + `M` → `VNT-APXTS-M`.
 *
 * Deterministic: the same id and size always give the same SKU. Neither the
 * product code nor the size code can contain a `-`, so the separators are
 * unambiguous — two different (product, size) pairs cannot run together into
 * the same string.
 *
 * The result is *stored* on the variant, not recomputed at render time. A SKU is
 * an identifier handed to people outside this codebase — a courier, a
 * warehouse, an invoice — and an identifier that silently changed because
 * somebody improved this function would be worse than one that is merely ugly.
 * An editor will be able to override it (a later stage), which is only
 * possible because it is a stored value.
 */
export function makeSku(productId: string, size: string): string {
  return `VNT-${productCode(productId)}-${sizeCode(size)}`;
}

/**
 * A product's variants as the size set and SKU rule would produce them, with
 * no per-size price. Empty for a category with no size set.
 */
export function defaultVariants(productId: string, categoryId: string): ProductVariant[] {
  return (sizesFor(categoryId) ?? []).map((size) => ({ size, sku: makeSku(productId, size) }));
}

/**
 * A product's variants, tolerating a published document that predates them.
 *
 * `Product.variants` is required by the type, but every site that published
 * before variants existed holds products with no such key — the seed is not
 * what a running site reads (§31). Reading `product.variants` directly there
 * gives `undefined`, and the product page would throw. An empty list instead
 * makes such a product behave exactly as it did before variants existed: no
 * picker, one price, Add to Bag enabled.
 *
 * **The one place that tolerance lives, and it is temporary.** Remove the
 * `?? []` once published documents are migrated. That is an open decision
 * from stage 1, and it has to be settled before the bag needs a real SKU —
 * after that, "no variants" can no longer mean "behave as before".
 */
export function variantsOf(product: { variants?: readonly ProductVariant[] }): readonly ProductVariant[] {
  return product.variants ?? [];
}

/** What one size costs, in whole rupees: its own price if it has one, the product's otherwise. */
export function variantPrice(product: { price: number }, variant: ProductVariant): number {
  return variant.price ?? product.price;
}

export interface PriceSummary {
  /** The cheapest size. What "From" refers to, and what a card shows. */
  lowest: number;
  highest: number;
  /** True only when at least two sizes genuinely cost different amounts. */
  varies: boolean;
}

/**
 * **The one answer to "do this product's prices differ by size?"** — used by
 * the product page, the product card (and so every rail and grid), and the
 * product page's metadata and structured data. Computing it inline in each of
 * those is how they would come to disagree.
 *
 * Compares what each size actually *costs*, not whether a size has a `price`
 * field. A product whose every size carries an override of ₹9,999 does not vary
 * — it simply costs ₹9,999 — and must not be shown as "From".
 */
export function priceSummary(product: {
  price: number;
  variants?: readonly ProductVariant[];
}): PriceSummary {
  const prices = variantsOf(product).map((v) => variantPrice(product, v));
  if (prices.length === 0) return { lowest: product.price, highest: product.price, varies: false };
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  return { lowest, highest, varies: lowest !== highest };
}

/**
 * The price label for a product whose size has not been chosen.
 *
 * "₹8,999" when every size costs the same — which is every product today — and
 * "From ₹5,499" only when they genuinely differ. **Never "From" on a single
 * price.** "From ₹8,999" when every size is ₹8,999 is a small lie, and its cost
 * is real: it sends people through the size list hunting for a cheaper one that
 * does not exist.
 */
export function listPriceLabel(product: {
  price: number;
  variants?: readonly ProductVariant[];
}): string {
  const { lowest, varies } = priceSummary(product);
  return varies ? `From ${formatINR(lowest)}` : formatINR(lowest);
}

/** Whether a size can be bought right now. Produced on the server by `lib/stock.ts`. */
export type StockStatus = "in-stock" | "sold-out";
