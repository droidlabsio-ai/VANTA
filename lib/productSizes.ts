import type { Product, ProductVariant } from "@/data/types";
import { makeSku, sizesFor, variantsOf } from "@/lib/variants";

/**
 * The sizes a product created in /admin is given, and when.
 *
 * Moved out of `components/admin/ProductDrawer.tsx` so the rule can be exercised
 * without the admin. The drawer imports the draft provider, which imports Next's
 * router, and that chain does not load outside Next — so logic left in the
 * component could only be checked by signing in, which a script cannot do.
 * Client-safe, like `lib/variants.ts`: no I/O, nothing server-only.
 */

/**
 * What a product gets when its category has no size set: one size, so it can
 * still be published.
 *
 * `sizesFor` only knows the category ids that exist in code (`SIZE_SETS`, §41),
 * so the Clothing and Accessories groups (§22) and any category created in
 * /admin have none. A single size keeps the editor moving instead of
 * dead-ending at Publish — and the drawer says so in plain words, rather than
 * presenting it as a real size set.
 */
export const FALLBACK_SIZES: readonly string[] = ["One Size"];

export interface PlannedSizes {
  variants: ProductVariant[];
  /** True when the category has no size set and the fallback was used. */
  fallback: boolean;
}

/**
 * The sizes a product with none would be given, or null until there is both an
 * id and a category to build them from. No `price` on any of them, so every
 * size inherits the product's price.
 */
export function planSizes(p: Product): PlannedSizes | null {
  if (!p.id || !p.categoryId) return null;
  const set = sizesFor(p.categoryId);
  const sizes = set ?? FALLBACK_SIZES;
  return {
    variants: sizes.map((size) => ({ size, sku: makeSku(p.id, size) })),
    fallback: set === undefined,
  };
}

/**
 * The product as it should be saved: its own sizes untouched if it has any,
 * otherwise the sizes planned from its id and category.
 *
 * **Created at save, not as fields change, and that is load-bearing.** A new
 * product's id is rewritten from its name on every keystroke. Generating the
 * moment an id and a category both existed would store SKUs built from whatever
 * was half-typed at that instant — `VNT-N-S` for a product about to be named
 * Nimbus Shell — and the rule below would then keep them for good. Until the
 * product is saved, the drawer shows the planned sizes live instead.
 *
 * **Existing sizes are never rewritten.** A SKU is handed to couriers,
 * warehouses and invoices (§41); one that changed because somebody edited a name
 * or moved a product to another category would be worse than one that is merely
 * ugly. A product that has sizes keeps them, whatever happens to its name or
 * category.
 */
export function withSizes(p: Product): Product {
  if (variantsOf(p).length > 0) return p;
  const planned = planSizes(p);
  return planned ? { ...p, variants: planned.variants } : p;
}
