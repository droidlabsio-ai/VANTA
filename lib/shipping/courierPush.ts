import "server-only";

import { prisma } from "@/lib/db";
import { paiseToRupees } from "@/lib/money";
import { COURIER_PUSH, claimDue, complete, fail } from "@/lib/outbox";
import {
  isShiprocketConfigured,
  pushOrder,
  trackingUrlFor,
  type ShipResult,
} from "@/lib/shipping/shiprocket";

/**
 * Handing an order to the courier.
 *
 * This is the other half of the fail-soft rule. `createOrder` and the Razorpay
 * webhook both queue a job here and return immediately; nothing in the buying
 * path calls Shiprocket. This module is what eventually does, from a drain
 * route or an admin pressing "re-push", where being slow costs nothing and
 * failing costs a retry rather than a sale.
 */

/**
 * Pushes one order, recording the outcome on the order itself.
 *
 * Idempotent on our side: an order that already has a `shiprocketOrderId` is
 * not pushed again. Shiprocket rejects a duplicate `order_id` anyway, but
 * relying on their rejection would mean a re-push of an already-shipped order
 * looked like a failure and started a retry cycle.
 */
export async function pushOrderToCourier(orderId: string): Promise<ShipResult<void>> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) return { ok: false, error: "order-not-found" };
  if (order.shiprocketOrderId) return { ok: true, value: undefined };
  if (!isShiprocketConfigured()) return { ok: false, error: "not-configured" };

  /**
   * Only an order that is actually owed. A cancelled or refunded order must
   * never reach a courier, and this is the last place to notice — the job may
   * have been queued hours ago, before anyone cancelled it.
   */
  if (order.status === "CANCELLED" || order.status === "REFUNDED") {
    return { ok: false, error: `order-is-${order.status.toLowerCase()}` };
  }
  if (order.status === "PENDING_PAYMENT") {
    return { ok: false, error: "order-not-paid" };
  }

  const result = await pushOrder({
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    email: order.email,
    name: order.shipName,
    phone: order.shipPhone,
    line1: order.shipLine1,
    line2: order.shipLine2,
    city: order.shipCity,
    state: order.shipState,
    pincode: order.shipPincode,
    // Their vocabulary, not ours. COD is COD; everything else has already been
    // paid by the time this runs, which is what they call Prepaid.
    paymentMethod: order.paymentMethod === "COD" ? "COD" : "Prepaid",
    // Paise to rupees, once, here at the boundary. Their API is in rupees and
    // nothing internal is — see `lib/money.ts`.
    subTotal: paiseToRupees(order.subtotal),
    items: order.items.map((item) => ({
      // The size in the name too, so whoever packs the parcel reads it
      // without looking the SKU up (§47).
      name: item.size ? `${item.title} (Size ${item.size})` : item.title,
      // Their `sku` is required. The variant's SKU since §47 — it is what the
      // warehouse picks by. Orders placed before that have none, and fall back
      // to the product id, the only stable identifier they carry.
      sku: item.sku ?? item.productId,
      units: item.quantity,
      sellingPrice: paiseToRupees(item.unitPrice),
    })),
  });

  if (!result.ok) {
    // The error is written to the order as well as the job, so the shipments
    // view can show it next to the order it is about rather than only in a
    // queue nobody thinks to look at.
    await prisma.order
      .update({ where: { id: orderId }, data: { courierError: result.error.slice(0, 500) } })
      .catch(() => {});
    return result;
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      shiprocketOrderId: result.value.shiprocketOrderId,
      shiprocketShipmentId: result.value.shipmentId,
      awb: result.value.awb,
      courierName: result.value.courierName,
      trackingUrl: result.value.awb ? trackingUrlFor(result.value.awb) : null,
      pushedToCourierAt: new Date(),
      // Cleared on success, so a stale message from a previous attempt does not
      // sit next to a shipment that is now moving.
      courierError: null,
      // PACKED, not SHIPPED: it has been handed over, not collected. The
      // courier's own webhook moves it on from here.
      status: order.status === "CONFIRMED" ? "PACKED" : order.status,
    },
  });

  return { ok: true, value: undefined };
}

/**
 * Works through the due jobs.
 *
 * Called by the drain route and after an admin re-push. Deliberately small and
 * bounded — this runs inside a request, and a queue that has built up during
 * an outage should drain over several invocations rather than one that times
 * out halfway and leaves no record of what it did.
 */
export async function drainCourierQueue(limit = 10): Promise<{ done: number; failed: number }> {
  const jobs = await claimDue(COURIER_PUSH, limit);

  let done = 0;
  let failed = 0;

  for (const job of jobs) {
    const result = await pushOrderToCourier(job.orderId);
    if (result.ok) {
      await complete(job.id);
      done++;
    } else {
      await fail(job.id, job.attempts, result.error);
      failed++;
    }
  }

  return { done, failed };
}
