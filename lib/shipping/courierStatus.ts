import type { OrderStatus } from "@/lib/generated/prisma/client";

/**
 * Translating a courier's status into ours.
 *
 * Shiprocket's vocabulary is much richer than our seven-value enum — MANIFEST
 * GENERATED, PICKED UP, IN TRANSIT, OUT FOR DELIVERY, RTO INITIATED, and
 * dozens more, each with a courier-specific label underneath. We deliberately
 * do not try to represent all of that. The raw string is stored on the order
 * and shown to the customer verbatim, because "Out for delivery" is more
 * useful to them than anything our enum could say.
 *
 * This function only answers a narrower question: has the order crossed one of
 * the few boundaries our own state machine cares about?
 *
 * Two rules keep it safe:
 *
 * - It never moves an order *backwards*. Courier events arrive out of order
 *   often enough — a webhook retry, a scan uploaded late — and a DELIVERED
 *   order reverting to SHIPPED because a stale "In Transit" scan landed would
 *   be visible to the customer and impossible to explain.
 * - It returns null when it does not recognise a status, leaving our status
 *   alone. An unmapped courier string is not a reason to guess.
 */

/** Where each of our statuses sits, so we never regress. Higher is later. */
const RANK: Record<OrderStatus, number> = {
  PENDING_PAYMENT: 0,
  CONFIRMED: 1,
  PACKED: 2,
  SHIPPED: 3,
  DELIVERED: 4,
  // Terminal and set by us, never by a courier. Ranked high so nothing here
  // can move an order out of them.
  CANCELLED: 9,
  REFUNDED: 9,
};

/**
 * Matched on substrings, case-insensitively, because the exact strings vary by
 * courier: "Delivered", "DELIVERED", "Delivered to consignee" are all the same
 * event. Ordered most-specific first — "out for delivery" contains "delivery"
 * and must not be read as delivered.
 */
/**
 * Return-to-origin is checked before anything else, and as a whole word.
 *
 * It used to sit in the list below *after* "delivered", so "RTO Delivered" —
 * the parcel arriving back at our warehouse — matched "delivered" first and
 * told the customer their order had been delivered (§43). An RTO status never
 * means the customer has it, whatever else the string says. It maps to SHIPPED:
 * the parcel is still with the courier as far as our state machine is
 * concerned, and the raw string ("RTO Delivered") is shown to the customer
 * as-is. Bounded by anything that is not a letter or digit — spaces, `_`, `-`
 * all occur in courier labels — so a word that merely contains the letters
 * cannot trip it.
 */
const RETURN_TO_ORIGIN = /(?<![a-z0-9])rto(?![a-z0-9])|return(?:ed)?[\s_]+to[\s_]+origin/i;

const RULES: Array<[needle: string, status: OrderStatus]> = [
  ["out for delivery", "SHIPPED"],
  ["undelivered", "SHIPPED"],
  ["delivered", "DELIVERED"],
  ["in transit", "SHIPPED"],
  ["shipped", "SHIPPED"],
  ["picked up", "SHIPPED"],
  ["pickup", "PACKED"],
  ["manifest", "PACKED"],
  ["canceled", "CANCELLED"],
  ["cancelled", "CANCELLED"],
];

export function courierStatusToOrderStatus(
  courierStatus: string | null,
  current: OrderStatus,
): OrderStatus | null {
  if (!courierStatus) return null;
  const needle = courierStatus.toLowerCase();

  if (RETURN_TO_ORIGIN.test(courierStatus)) {
    return RANK.SHIPPED > RANK[current] ? "SHIPPED" : null;
  }

  const match = RULES.find(([text]) => needle.includes(text));
  if (!match) return null;

  const [, mapped] = match;

  /**
   * A courier may not cancel an order. "Canceled" from their side means the
   * shipment was cancelled, which is a shipping problem for staff to resolve —
   * the order itself may still be owed, paid for, and about to be re-shipped.
   */
  if (mapped === "CANCELLED") return null;

  return RANK[mapped] > RANK[current] ? mapped : null;
}
