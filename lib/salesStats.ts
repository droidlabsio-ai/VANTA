import "server-only";

import { contentStore } from "@/lib/contentStore";
import { hasDatabase, prisma } from "@/lib/db";
import { SALE_STATUSES } from "@/lib/orderStatus";
import { variantsOf } from "@/lib/variants";

/**
 * The numbers on the admin home page (§49).
 *
 * **A sale** is an order that is owed or delivered: CONFIRMED, PACKED, SHIPPED
 * or DELIVERED. Not counted: unpaid online orders (no money yet), cancelled and
 * refunded ones (no money kept). COD orders count from the moment they are
 * placed — that is when the shop commits to them — which slightly flatters the
 * figure if a COD parcel is later refused; step 4's courier statuses will mark
 * those.
 *
 * **Days are Indian days.** "Today" starts at midnight IST, not UTC, or every
 * order before 05:30 would land on yesterday.
 *
 * Grouped in JavaScript over one indexed read rather than in SQL: a month of
 * orders for a shop this size is a few hundred rows, and keeping the maths
 * here keeps it readable and testable. Capped so a far larger month degrades
 * to "approximately" rather than to a slow page.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const CHART_DAYS = 14;
const WINDOW_DAYS = 30;
export const LOW_STOCK = 3;
const MAX_ROWS = 5000;

/** Midnight IST of the day containing `at`, as a UTC instant. */
function istDayStart(at: number): number {
  return Math.floor((at + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

/** "26 Sept" for an IST day start. */
function dayLabel(start: number): string {
  return new Date(start).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });
}

export interface SalesStats {
  today: { revenue: number; orders: number };
  month: { revenue: number; orders: number; average: number };
  /** Oldest first, `CHART_DAYS` entries, zero-filled. Paise. */
  daily: Array<{ label: string; revenue: number; orders: number }>;
  bestSellers: Array<{ title: string; quantity: number; revenue: number }>;
  lowStock: Array<{ product: string; size: string; sku: string; quantity: number }>;
  todo: { toPack: number; awaitingPayment: number; refundNeeded: number };
}

const EMPTY: SalesStats = {
  today: { revenue: 0, orders: 0 },
  month: { revenue: 0, orders: 0, average: 0 },
  daily: [],
  bestSellers: [],
  lowStock: [],
  todo: { toPack: 0, awaitingPayment: 0, refundNeeded: 0 },
};

export async function salesStats(now = Date.now()): Promise<SalesStats | null> {
  if (!hasDatabase()) return null;

  const todayStart = istDayStart(now);
  const monthStart = todayStart - (WINDOW_DAYS - 1) * DAY_MS;
  const chartStart = todayStart - (CHART_DAYS - 1) * DAY_MS;
  const sale = { status: { in: SALE_STATUSES }, placedAt: { gte: new Date(monthStart) } };

  const [orders, best, stockRows, toPack, awaitingPayment, refundNeeded, { products }] =
    await Promise.all([
      prisma.order.findMany({
        where: sale,
        select: { placedAt: true, total: true },
        take: MAX_ROWS,
      }),
      prisma.orderItem.groupBy({
        by: ["title"],
        where: { order: sale },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      }),
      prisma.stockLevel.findMany({
        where: { quantity: { lte: LOW_STOCK } },
        orderBy: { quantity: "asc" },
        take: 50,
      }),
      prisma.order.count({ where: { status: { in: ["CONFIRMED", "PACKED"] } } }),
      prisma.order.count({ where: { status: "PENDING_PAYMENT" } }),
      prisma.order.count({
        where: { status: "CANCELLED", paidAt: { not: null }, refundedAt: null },
      }),
      contentStore.read(),
    ]);

  const stats: SalesStats = structuredClone(EMPTY);

  const byDay = new Map<number, { revenue: number; orders: number }>();
  for (const order of orders) {
    const at = order.placedAt.getTime();
    stats.month.revenue += order.total;
    stats.month.orders += 1;
    if (at >= todayStart) {
      stats.today.revenue += order.total;
      stats.today.orders += 1;
    }
    if (at >= chartStart) {
      const day = istDayStart(at);
      const bucket = byDay.get(day) ?? { revenue: 0, orders: 0 };
      bucket.revenue += order.total;
      bucket.orders += 1;
      byDay.set(day, bucket);
    }
  }
  stats.month.average = stats.month.orders ? Math.round(stats.month.revenue / stats.month.orders) : 0;

  for (let i = 0; i < CHART_DAYS; i++) {
    const day = chartStart + i * DAY_MS;
    const bucket = byDay.get(day) ?? { revenue: 0, orders: 0 };
    stats.daily.push({ label: dayLabel(day), ...bucket });
  }

  stats.bestSellers = best.map((row) => ({
    title: row.title,
    quantity: row._sum.quantity ?? 0,
    revenue: row._sum.lineTotal ?? 0,
  }));

  // SKU → product and size, from the published catalogue. A SKU the catalogue
  // no longer has is still listed (by SKU) — stock for it is still stock.
  const bySku = new Map<string, { product: string; size: string }>();
  for (const product of products) {
    for (const variant of variantsOf(product)) {
      bySku.set(variant.sku, { product: product.name, size: variant.size });
    }
  }
  stats.lowStock = stockRows.map((row) => ({
    product: bySku.get(row.sku)?.product ?? row.sku,
    size: bySku.get(row.sku)?.size ?? "",
    sku: row.sku,
    quantity: Math.max(0, row.quantity),
  }));

  stats.todo = { toPack, awaitingPayment, refundNeeded };
  return stats;
}
