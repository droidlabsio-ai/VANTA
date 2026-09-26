import "server-only";

import { hasDatabase, prisma } from "@/lib/db";
import { releaseStock } from "@/lib/stock";

/**
 * How long an unpaid online order holds its stock (§48).
 *
 * Checkout takes stock the moment an order is written (§47), paid or not, so
 * a shopper who chooses "Pay online" and walks away would otherwise hold the
 * last M for ever. Three numbers, each with a job:
 *
 * - **PAY_START_WINDOW** — "Pay now" is offered for 30 minutes after placing.
 *   Long enough to find a phone and a UPI PIN; short enough that an abandoned
 *   order frees its sizes the same hour.
 * - **CHECKOUT_TIMEOUT** — Razorpay's payment window closes itself after 15
 *   minutes (their `timeout` option), so a window opened at minute 29 still
 *   ends by minute 44.
 * - **EXPIRE_AFTER** — the order is cancelled and its stock returned at 60
 *   minutes: the latest a window can close, plus a margin for a slow bank and
 *   a slow webhook.
 *
 * A payment that still lands after that is not lost — see `latePayment` in the
 * webhook: the order is re-confirmed if its sizes are still there, and flagged
 * for a refund in /admin/orders if not.
 */
export const PAY_START_WINDOW_MS = 30 * 60 * 1000;
export const CHECKOUT_TIMEOUT_SECONDS = 15 * 60;
export const EXPIRE_AFTER_MS = 60 * 60 * 1000;

export const PAYMENT_TIMEOUT_REASON = "payment-timeout";

/** Whether "Pay now" may still be offered for an order placed at `placedAt`. */
export function canStartPayment(placedAt: Date, now = Date.now()): boolean {
  return now - placedAt.getTime() < PAY_START_WINDOW_MS;
}

/**
 * Cancels unpaid online orders past `EXPIRE_AFTER_MS` and returns their stock.
 *
 * There is no scheduler yet (step 4 adds one), so this runs where the answer
 * matters: before checkout checks stock, and when /admin/orders is opened.
 * It is cheap when there is nothing to do — one indexed read — and safe to run
 * twice at once: each order is claimed with a conditional update on
 * `status = PENDING_PAYMENT`, so only one run cancels it and only that run
 * gives its stock back.
 *
 * Never throws: a failed sweep must not block the checkout that triggered it.
 * Returns how many orders it cancelled.
 */
export async function expireUnpaidOrders(limit = 25): Promise<number> {
  if (!hasDatabase()) return 0;
  try {
    const cutoff = new Date(Date.now() - EXPIRE_AFTER_MS);
    const stale = await prisma.order.findMany({
      where: { status: "PENDING_PAYMENT", paymentMethod: "ONLINE", placedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { placedAt: "asc" },
      take: limit,
    });

    let cancelled = 0;
    for (const { id } of stale) {
      const done = await prisma.$transaction(async (tx) => {
        const claimed = await tx.order.updateMany({
          where: { id, status: "PENDING_PAYMENT", paidAt: null },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelReason: PAYMENT_TIMEOUT_REASON,
          },
        });
        if (claimed.count === 0) return false;
        const items = await tx.orderItem.findMany({
          where: { orderId: id },
          select: { sku: true, quantity: true },
        });
        await releaseStock(tx, items);
        return true;
      });
      if (done) cancelled++;
    }
    return cancelled;
  } catch (error) {
    console.error("[payments] could not expire unpaid orders:", error);
    return 0;
  }
}
