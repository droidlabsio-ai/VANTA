"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/adminSession";
import { recordAudit } from "@/lib/auditLog";
import { hasDatabase, prisma } from "@/lib/db";
import { COURIER_PUSH, enqueue } from "@/lib/outbox";
import { drainCourierQueue, pushOrderToCourier } from "@/lib/shipping/courierPush";
import { createRefund, isRazorpayConfigured } from "@/lib/payments/razorpay";
import { releaseStock } from "@/lib/stock";

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
 * CONFIRMED (not yet packed). A packed or shipped order's goods are with the
 * courier or the customer; they come back as a return, which is counted by
 * hand on /admin/stock. A cancelled order already returned its stock when it
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

  const restock = order.status === "CONFIRMED";
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
  revalidatePath("/admin/stock");
  return {
    ok: true,
    message: `Refund ${result.value.status === "processed" ? "done" : "started"} (${result.value.id}).`,
  };
}
