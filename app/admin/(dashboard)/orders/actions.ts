"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/adminSession";
import { recordAudit } from "@/lib/auditLog";
import { hasDatabase, prisma } from "@/lib/db";
import { COURIER_PUSH, enqueue } from "@/lib/outbox";
import { drainCourierQueue, pushOrderToCourier } from "@/lib/shipping/courierPush";
import { createRefund, isRazorpayConfigured } from "@/lib/payments/razorpay";
import { releaseStock } from "@/lib/stock";
import {
  STOCK_STILL_HERE,
  canCancel,
  isValidStep,
  type OrderStatusValue,
} from "@/lib/orderStatus";

/**
 * Staff actions on the shipments view.
 *
 * Both re-establish the caller with `requireAdmin()` rather than trusting the
 * page that rendered the button — a Server Action is a public endpoint with a
 * hard-to-guess name, and the admin layout's session check does not cover it.
 */

/**
 * Push one order to the courier, now.
 *
 * The button exists because the outbox drains on a schedule, and "on a
 * schedule" is not good enough when someone is standing at a packing table
 * waiting for a label. It queues *and* runs, so the retry machinery still owns
 * the outcome if this attempt fails.
 */
export async function rePushOrderAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  if (!hasDatabase()) return;

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true },
  });
  if (!order) return;

  await enqueue(COURIER_PUSH, order.id);
  const result = await pushOrderToCourier(order.id);

  await recordAudit({
    actor: admin.username,
    action: result.ok ? "courier.pushed" : "courier.push_failed",
    target: order.orderNumber,
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${order.orderNumber}`);
}

/** Works through whatever is due, for when a backlog needs clearing by hand. */
export async function drainQueueAction(): Promise<void> {
  const admin = await requireAdmin();
  if (!hasDatabase()) return;

  const { done, failed } = await drainCourierQueue(25);

  await recordAudit({
    actor: admin.username,
    action: "courier.queue_drained",
    target: `${done} pushed, ${failed} failed`,
  });

  revalidatePath("/admin/orders");
}

export interface RefundState {
  ok: boolean;
  message: string | null;
}

/**
 * Refund an online payment in full, from /admin/orders (§48).
 *
 * Full refunds only. A partial refund needs a way to say *which* lines came
 * back, and the order has nowhere to record that yet — step 6's order screen
 * is where it belongs.
 *
 * Razorpay first, database second. If Razorpay refuses, nothing here changes
 * and the reason is shown. If Razorpay accepts and the database write then
 * fails, pressing Refund again is safe: the receipt `refund-<orderNumber>` is
 * Razorpay's idempotency key, so the second press gets the first refund back
 * instead of paying out twice (`createRefund`).
 *
 * Stock goes back only for an order that had not left the building —
 * CONFIRMED or PACKED (§49 added PACKED: a packed box is still on the shelf).
 * A shipped order's goods are with the courier or the customer; they come back
 * as a return, which is counted by hand on /admin/stock. A cancelled order already returned its stock when it
 * was cancelled.
 */
export async function refundOrderAction(
  _previous: RefundState,
  formData: FormData,
): Promise<RefundState> {
  const admin = await requireAdmin();
  if (!hasDatabase()) return { ok: false, message: "No database." };
  if (!isRazorpayConfigured()) return { ok: false, message: "Razorpay isn’t set up." };

  const orderId = String(formData.get("orderId") ?? "");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      total: true,
      paymentMethod: true,
      razorpayPaymentId: true,
      paidAt: true,
      refundedAt: true,
    },
  });
  if (!order) return { ok: false, message: "Order not found." };
  if (order.paymentMethod !== "ONLINE" || !order.paidAt || !order.razorpayPaymentId) {
    return { ok: false, message: "Only paid online orders can be refunded here." };
  }
  if (order.refundedAt) return { ok: false, message: "Already refunded." };

  const result = await createRefund({
    paymentId: order.razorpayPaymentId,
    amountPaise: order.total,
    receipt: `refund-${order.orderNumber}`,
    notes: { orderNumber: order.orderNumber, by: admin.username },
  });

  if (!result.ok) {
    await recordAudit({
      actor: admin.username,
      action: "payment.refund_failed",
      target: order.orderNumber,
      detail: { error: result.error },
    });
    return { ok: false, message: result.error };
  }

  const restock = order.status === "CONFIRMED" || order.status === "PACKED";
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, refundedAt: null },
      data: {
        status: "REFUNDED",
        refundedAt: new Date(),
        razorpayRefundId: result.value.id,
        refundStatus: result.value.status,
      },
    });
    if (claimed.count > 0 && restock) {
      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { sku: true, quantity: true },
      });
      await releaseStock(tx, items);
    }
    // An order refunded before it reached the courier must not be sent now.
    await tx.outboxJob.updateMany({
      where: { kind: COURIER_PUSH, orderId: order.id, completedAt: null },
      data: { completedAt: new Date(), lastError: "refunded" },
    });
  });

  await recordAudit({
    actor: admin.username,
    action: "payment.refunded",
    target: order.orderNumber,
    detail: { refundId: result.value.id, amount: order.total, restocked: restock },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${order.orderNumber}`);
  revalidatePath("/admin/stock");
  return {
    ok: true,
    message: `Refund ${result.value.status === "processed" ? "done" : "started"} (${result.value.id}).`,
  };
}

/**
 * Move an order one step forward: packed, shipped, delivered (§49).
 *
 * Only the single next step is accepted (`lib/orderStatus.ts`), and the update
 * is conditional on the status still being the one the page showed — two
 * people pressing at once, or the courier webhook moving it meanwhile, cannot
 * make it skip a step or go backwards.
 *
 * "Mark shipped" can carry the AWB, courier and tracking link for a parcel
 * booked by hand, so the customer's order page shows tracking even without
 * Shiprocket. Blank fields leave whatever the courier integration wrote.
 */
export async function advanceOrderAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  if (!hasDatabase()) return;

  const orderId = String(formData.get("orderId") ?? "");
  const from = String(formData.get("from") ?? "") as OrderStatusValue;
  const to = String(formData.get("to") ?? "") as OrderStatusValue;
  if (!isValidStep(from, to)) return;

  const text = (name: string, max: number) => {
    const value = String(formData.get(name) ?? "").trim().slice(0, max);
    return value || undefined;
  };
  const trackingUrl = text("trackingUrl", 500);
  const tracking =
    to === "SHIPPED"
      ? {
          awb: text("awb", 64),
          courierName: text("courierName", 80),
          // Only an http(s) link: it is rendered as a link on the customer's page.
          trackingUrl: trackingUrl && /^https?:\/\//i.test(trackingUrl) ? trackingUrl : undefined,
        }
      : {};

  const updated = await prisma.order.updateMany({
    where: { id: orderId, status: from },
    data: { status: to, ...tracking },
  });
  if (updated.count === 0) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { orderNumber: true },
  });
  await recordAudit({
    actor: admin.username,
    action: "order.status_changed",
    target: order?.orderNumber,
    detail: { from, to },
  });

  revalidatePath("/admin/orders");
  if (order) revalidatePath(`/admin/orders/${order.orderNumber}`);
  revalidatePath("/admin");
}

export interface CancelState {
  ok: boolean;
  message: string | null;
}

/**
 * Cancel an order that hasn't left and hasn't been paid online (§49).
 *
 * COD orders and unpaid online orders only — `canCancel` explains why a paid
 * online order is refunded instead. Stock goes back in the same transaction,
 * claimed on the status the page showed, so it is returned exactly once. The
 * courier job is closed so a cancelled order is never booked; if it was
 * already booked with Shiprocket, the page says to cancel it there too.
 */
export async function cancelOrderAction(
  _previous: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const admin = await requireAdmin();
  if (!hasDatabase()) return { ok: false, message: "No database." };

  const orderId = String(formData.get("orderId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200) || "cancelled-by-staff";

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, status: true, paymentMethod: true, paidAt: true },
  });
  if (!order) return { ok: false, message: "Order not found." };
  if (!canCancel(order)) {
    return {
      ok: false,
      message:
        order.paymentMethod === "ONLINE" && order.paidAt
          ? "This order is paid — use Refund, which also cancels it."
          : "This order can no longer be cancelled here.",
    };
  }

  const done = await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    if (claimed.count === 0) return false;
    if (STOCK_STILL_HERE.has(order.status)) {
      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { sku: true, quantity: true },
      });
      await releaseStock(tx, items);
    }
    await tx.outboxJob.updateMany({
      where: { kind: COURIER_PUSH, orderId: order.id, completedAt: null },
      data: { completedAt: new Date(), lastError: "cancelled" },
    });
    return true;
  });
  if (!done) return { ok: false, message: "The order changed meanwhile — reload and try again." };

  await recordAudit({
    actor: admin.username,
    action: "order.cancelled",
    target: order.orderNumber,
    detail: { from: order.status, reason },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${order.orderNumber}`);
  revalidatePath("/admin/stock");
  revalidatePath("/admin");
  return { ok: true, message: "Order cancelled. Stock returned." };
}
