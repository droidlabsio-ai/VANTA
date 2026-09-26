import "server-only";

import type { ProductVariant } from "@/data/types";
import type { StockStatus } from "@/lib/variants";
import { hasDatabase, prisma } from "@/lib/db";

/**
 * Stock, per size, in Postgres (§47). §41 left this file as a seam that said
 * "in stock" for everything; the callers are unchanged, the insides are real.
 *
 * The rule, decided here and nowhere else: **a SKU with no `StockLevel` row is
 * not tracked, and is always available.** A row at 0 or below is sold out.
 * That lets the shop run before anyone has counted anything, and lets tracking
 * start one product at a time from `/admin/stock`.
 *
 * With no database, nothing can be tracked, so everything is available — the
 * same answer as before §47.
 */

/** Current quantities for the given SKUs. SKUs without a row are absent from the map. */
export async function stockLevels(skus: readonly string[]): Promise<Map<string, number>> {
  if (!hasDatabase() || skus.length === 0) return new Map();
  const rows = await prisma.stockLevel.findMany({
    where: { sku: { in: [...new Set(skus)] } },
    select: { sku: true, quantity: true },
  });
  return new Map(rows.map((r) => [r.sku, r.quantity]));
}

/**
 * Whether each size can be bought, keyed by SKU — an explicit status for every
 * SKU asked about, so no caller has to decide what absence means.
 */
export async function stockStatus(
  variants: readonly ProductVariant[],
): Promise<Record<string, StockStatus>> {
  const levels = await stockLevels(variants.map((v) => v.sku));
  return Object.fromEntries(
    variants.map((v) => {
      const quantity = levels.get(v.sku);
      return [v.sku, quantity !== undefined && quantity <= 0 ? "sold-out" : "in-stock"] as const;
    }),
  );
}

/** Every sold-out SKU — for pages that hold a whole bag and cannot ask product by product. */
export async function soldOutSkus(): Promise<string[]> {
  if (!hasDatabase()) return [];
  const rows = await prisma.stockLevel.findMany({
    where: { quantity: { lte: 0 } },
    select: { sku: true },
  });
  return rows.map((r) => r.sku);
}

/**
 * Thrown inside the order transaction when a tracked size cannot cover the
 * quantity ordered. Rolls the whole order back.
 */
export class OutOfStockError extends Error {
  constructor(
    readonly sku: string,
    readonly available: number,
  ) {
    super(`Not enough stock for ${sku}: ${available} left.`);
  }
}

type Tx = Pick<typeof prisma, "stockLevel">;

/**
 * Takes `quantity` of each tracked SKU, atomically, inside the caller's
 * transaction.
 *
 * One conditional `UPDATE … WHERE quantity >= n` per SKU: two shoppers buying
 * the last M race to one winner, because the second update finds the row
 * already at 0 and matches nothing. A SKU with no row is untracked and passes.
 * Called in the same transaction that creates the order, so a failure on any
 * line leaves no order and no stock taken.
 */
export async function reserveStock(
  tx: Tx,
  lines: ReadonlyArray<{ sku: string | null; quantity: number }>,
): Promise<void> {
  const bySku = new Map<string, number>();
  for (const line of lines) {
    if (!line.sku) continue;
    bySku.set(line.sku, (bySku.get(line.sku) ?? 0) + line.quantity);
  }
  for (const [sku, quantity] of bySku) {
    const taken = await tx.stockLevel.updateMany({
      where: { sku, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });
    if (taken.count > 0) continue;
    const row = await tx.stockLevel.findUnique({ where: { sku }, select: { quantity: true } });
    if (row) throw new OutOfStockError(sku, Math.max(0, row.quantity));
  }
}

/**
 * Puts stock back for an order that will not ship — an unpaid order that timed
 * out, or a refund before packing (§48).
 *
 * Only SKUs that are still counted get anything back. A size someone stopped
 * counting since (row deleted) stays uncounted; creating a row here would
 * quietly start tracking it with a meaningless number.
 */
export async function releaseStock(
  tx: Tx,
  lines: ReadonlyArray<{ sku: string | null; quantity: number }>,
): Promise<void> {
  const bySku = new Map<string, number>();
  for (const line of lines) {
    if (!line.sku) continue;
    bySku.set(line.sku, (bySku.get(line.sku) ?? 0) + line.quantity);
  }
  for (const [sku, quantity] of bySku) {
    await tx.stockLevel.updateMany({ where: { sku }, data: { quantity: { increment: quantity } } });
  }
}
