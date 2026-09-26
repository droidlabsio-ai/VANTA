/**
 * What staff may do to an order by hand, and what each move means (§49).
 *
 * Kept in one table so the admin page (which buttons to show) and the server
 * action (what to accept) cannot disagree. The courier webhook moves orders
 * too; this only governs the buttons.
 *
 * Deliberately narrow:
 * - forward only (CONFIRMED → PACKED → SHIPPED → DELIVERED), one step at a
 *   time — a slip of the mouse must not turn an unpacked order "Delivered";
 * - "Cancel" only before the parcel leaves (PENDING_PAYMENT, CONFIRMED,
 *   PACKED). After that it is a return, handled on the courier's side;
 * - a **paid** online order is not cancelled here — it is refunded, which
 *   cancels it and gives the money back in one step. Cancelling it without the
 *   refund would keep a customer's money for nothing.
 */

export type OrderStatusValue =
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "REFUNDED";

export const STATUS_LABEL: Record<OrderStatusValue, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** The one forward move each status allows, with its button text. */
export const NEXT_STEP: Partial<Record<OrderStatusValue, { to: OrderStatusValue; label: string }>> = {
  CONFIRMED: { to: "PACKED", label: "Mark packed" },
  PACKED: { to: "SHIPPED", label: "Mark shipped" },
  SHIPPED: { to: "DELIVERED", label: "Mark delivered" },
};

/** Statuses whose goods are still on the shelf, so cancelling returns stock. */
export const STOCK_STILL_HERE: ReadonlySet<OrderStatusValue> = new Set([
  "PENDING_PAYMENT",
  "CONFIRMED",
  "PACKED",
]);

/** Orders that count as sales: owed or delivered, not cancelled, not refunded, not unpaid. */
export const SALE_STATUSES: OrderStatusValue[] = ["CONFIRMED", "PACKED", "SHIPPED", "DELIVERED"];

export function canCancel(order: {
  status: OrderStatusValue;
  paymentMethod: "COD" | "ONLINE";
  paidAt: Date | null;
}): boolean {
  if (!STOCK_STILL_HERE.has(order.status)) return false;
  // Paid online → refund instead (see above).
  return !(order.paymentMethod === "ONLINE" && order.paidAt);
}

export function isValidStep(from: OrderStatusValue, to: OrderStatusValue): boolean {
  return NEXT_STEP[from]?.to === to;
}
