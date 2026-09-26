import type { Product, ProductVariant } from "@/data/types";
import { variantPrice, variantsOf } from "@/lib/variants";

/**
 * A bag line, and how it resolves against the catalogue (§47).
 *
 * Shared by the browser bag, the signed-in mirror and checkout, so all three
 * agree on what a line *is*. Before §47 a line was `{ id, qty }` and the size a
 * shopper picked was thrown away; now it carries the variant's SKU.
 *
 * `sku` is optional on purpose. Bags written before this change live on in
 * shoppers' browsers and in `BagLine` rows, and they have no SKU. They are kept,
 * not dropped: a one-size product resolves to its only size on its own, and a
 * multi-size one asks for a size in the bag before checkout will take it.
 */
export interface BagLine {
  id: string;
  sku?: string;
  qty: number;
}

/** Two lines are the same line when product and size match — `M` and `L` of one jacket are two lines. */
export function lineKey(line: { id: string; sku?: string | null }): string {
  return line.sku ? `${line.id}::${line.sku}` : line.id;
}

export type LineResolution =
  | { status: "ok"; variant: ProductVariant | null; unitPrice: number }
  /** A multi-size product with no size chosen — a pre-§47 line. */
  | { status: "needs-size"; variant: null; unitPrice: number }
  /** A SKU the product no longer has (the size was removed in the admin). */
  | { status: "unknown-size"; variant: null; unitPrice: number };

/**
 * Which variant a line means, and what it costs (whole rupees, like `Product.price`).
 *
 * SKUs compare case-insensitively, as the publish rules do (§41).
 */
export function resolveLine(product: Product, sku: string | null | undefined): LineResolution {
  const variants = variantsOf(product);

  if (sku) {
    const wanted = sku.trim().toUpperCase();
    const variant = variants.find((v) => v.sku.trim().toUpperCase() === wanted);
    return variant
      ? { status: "ok", variant, unitPrice: variantPrice(product, variant) }
      : { status: "unknown-size", variant: null, unitPrice: product.price };
  }

  if (variants.length === 1) {
    const [only] = variants;
    return { status: "ok", variant: only, unitPrice: variantPrice(product, only) };
  }
  if (variants.length === 0) {
    // Only a product with neither a seed match nor a category (§42); sold as one item.
    return { status: "ok", variant: null, unitPrice: product.price };
  }
  return { status: "needs-size", variant: null, unitPrice: product.price };
}

/** The SKU to store when a product is added without a size choice — its only size, if it has one. */
export function onlySku(product: Product): string | undefined {
  const variants = variantsOf(product);
  return variants.length === 1 ? variants[0].sku : undefined;
}
