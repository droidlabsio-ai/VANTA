"use server";

import { hasDatabase, prisma } from "@/lib/db";
import { getCustomer } from "@/lib/auth/customerSession";
import { verifyOrderToken } from "@/lib/orders";
import { createRazorpayOrder, isRazorpayConfigured, razorpayKeyId } from "@/lib/payments/razorpay";
import { CHECKOUT_TIMEOUT_SECONDS, canStartPayment } from "@/lib/payments/expiry";

/**
 * Starting (or restarting) a payment.
 *
 * This exists because the handoff at checkout is best-effort: Razorpay may
 * have been unreachable at the moment the order was placed, or the customer
 * may have closed the payment sheet and come back an hour later. Either way
 * the order is real and unpaid, and there has to be a way to pay it.
 *
 * What this deliberately does NOT do is change the order's status. It only
 * hands the browser the identifiers Razorpay's checkout needs. Payment is
 * recorded by the webhook and nowhere else — see
 * `app/api/webhooks/razorpay/route.ts` for why.
 */

export interface PaymentHandoff {
  ok: boolean;
  error?: string;
  keyId?: string;
  razorpayOrderId?: string;
  /** Paise. Passed to their checkout, and re-checked by us on the webhook. */
  amount?: number;
  orderNumber?: string;
  email?: string;
  name?: string;
  phone?: string;
  /** Seconds Razorpay's window stays open (§48). */
  timeout?: number;
}

/**
 * Authorised exactly as the order page is: by session, or by the signed guest
 * token. A Server Action is a public POST endpoint, so the token cannot be
 * assumed to have been checked by whatever rendered the button.
 */
export async function startPayment(
  orderNumber: string,
  token: string | undefined,
): Promise<PaymentHandoff> {
  if (!hasDatabase()) return { ok: false, error: "Payments aren’t available right now." };
  if (!isRazorpayConfigured()) return { ok: false, error: "Online payment isn’t set up yet." };

  const order = await prisma.order.findUnique({ where: { orderNumber } });
  if (!order) return { ok: false, error: "Order not found." };

  const customer = await getCustomer();
  const authorised =
    (customer && order.customerId === customer.id) || verifyOrderToken(orderNumber, token);
  // Same wording as a missing order, for the same reason the page 404s rather
  // than forbidding: "not yours" confirms the order number is real.
  if (!authorised) return { ok: false, error: "Order not found." };

  if (order.paymentMethod !== "ONLINE") {
    return { ok: false, error: "This order isn’t an online payment." };
  }
  if (order.status === "CANCELLED") {
    return { ok: false, error: "This order was cancelled because it wasn’t paid in time. Please order again." };
  }
  if (order.status !== "PENDING_PAYMENT") {
    return { ok: false, error: "This order has already been paid." };
  }
  // §48: stock is held for a limited time. Past the window the sweep will
  // cancel the order, so a payment started now could land on a cancelled one.
  if (!canStartPayment(order.placedAt)) {
    return {
      ok: false,
      error: "The time to pay for this order has run out. Please place the order again.",
    };
  }

  /**
   * Reuse the existing Razorpay order when there is one.
   *
   * Creating a second one for the same order would mean two payment surfaces
   * for one debt, and a customer could pay both. Razorpay orders survive
   * abandoned attempts, so the one made at checkout is still the right one an
   * hour later.
   */
  let razorpayOrderId = order.razorpayOrderId;

  if (!razorpayOrderId) {
    const result = await createRazorpayOrder({
      amountPaise: order.total,
      receipt: order.orderNumber,
      notes: { orderNumber: order.orderNumber },
    });
    if (!result.ok) {
      console.error(`[razorpay] retry failed for ${orderNumber}: ${result.error}`);
      return { ok: false, error: "Couldn’t reach the payment provider. Please try again." };
    }
    razorpayOrderId = result.value.id;
    await prisma.order.update({ where: { id: order.id }, data: { razorpayOrderId } });
  }

  const keyId = razorpayKeyId();
  if (!keyId) return { ok: false, error: "Online payment isn’t set up yet." };

  return {
    ok: true,
    keyId,
    razorpayOrderId,
    amount: order.total,
    orderNumber: order.orderNumber,
    email: order.email,
    name: order.shipName,
    phone: order.shipPhone,
    timeout: CHECKOUT_TIMEOUT_SECONDS,
  };
}
