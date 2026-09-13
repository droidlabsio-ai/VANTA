import "server-only";

import type { ProductVariant } from "@/data/types";
import type { StockStatus } from "@/lib/variants";

/**
 * Whether each size can be bought, keyed by SKU.
 *
 * **Always "in-stock" today, and that is true rather than optimistic.** There
 * is no stock anywhere yet — it arrives in Postgres, keyed by SKU; see the
 * comment on `ProductVariant` for why it cannot live in the content document —
 * so nothing can be sold out. The storefront's sold-out rendering is built and
 * driven from this function, so the stage that adds stock replaces its insides
 * with a query and nothing that calls it changes.
 *
 * Server-only and async for exactly that reason. Stock will live in a database
 * the browser cannot reach, so availability has to be answered on the server
 * and handed down as props. Making it async now means that query can be added
 * without every caller gaining an `await` it did not have.
 *
 * An explicit status for every SKU rather than a list of the sold-out ones:
 * once this is a query, a SKU missing from the result has to mean something
 * decided *here*, not something each caller infers from absence.
 */
export async function stockStatus(
  variants: readonly ProductVariant[],
): Promise<Record<string, StockStatus>> {
  return Object.fromEntries(variants.map((v) => [v.sku, "in-stock" as const]));
}
