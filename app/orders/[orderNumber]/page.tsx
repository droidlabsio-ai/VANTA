import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { contentStore } from "@/lib/contentStore";
import { hasDatabase, prisma } from "@/lib/db";
import { getCustomer } from "@/lib/auth/customerSession";
import { verifyOrderToken } from "@/lib/orders";
import { formatPaise } from "@/lib/money";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BottomNav } from "@/components/BottomNav";
import { OrderPlaced } from "@/components/OrderPlaced";
import { RazorpayPayButton } from "@/components/checkout/RazorpayPayButton";
import { isRazorpayConfigured } from "@/lib/payments/razorpay";
import { PAYMENT_TIMEOUT_REASON, canStartPayment } from "@/lib/payments/expiry";

/**
 * Someone's name, address, phone and what they bought. Never indexed, never
 * followed — and the guest link is an unguessable HMAC, so a crawler that did
 * reach one would have been handed it.
 *
 * No canonical, deliberately, and this is the one route where that is right:
 * a canonical is a request to index *something*, and there is no version of
 * this page that should be in an index. `noindex` and a canonical together are
 * a contradictory instruction.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Your order",
  description: "Your VANTA order — items, delivery address, payment status and courier tracking.",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/**
 * One order.
 *
 * Two ways in, and both are checked here rather than assumed:
 *
 * - The **owning customer**, established from the session. An order belonging
 *   to somebody else is `notFound`, not "forbidden" — telling a stranger that
 *   order VNT-2026-00041 exists but is not theirs confirms it exists.
 * - A **guest**, via `?t=` — an HMAC of the order number. Order numbers are
 *   sequential, so without a token, guessing the next one would hand over the
 *   previous customer's name, phone and address.
 *
 * Everything rendered comes from the order's own snapshot, never from the
 * catalogue. A product renamed, repriced or deleted since must not change what
 * this page says was bought.
 */
/**
 * Per-customer, so never prerendered. Stated rather than inferred: this page
 * built as static because `getCustomer()` returns before touching `cookies()`
 * when no database is configured, so nothing marked it dynamic. DECISIONS §26.
 */
export const dynamic = "force-dynamic";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string; placed?: string }>;
}) {
  const [{ orderNumber }, query] = await Promise.all([params, searchParams]);

  if (!hasDatabase()) notFound();

  const [customer, { homepage }] = await Promise.all([getCustomer(), contentStore.read()]);

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { items: { orderBy: { title: "asc" } } },
  });

  if (!order) notFound();

  const ownsIt = Boolean(customer && order.customerId === customer.id);
  const hasValidToken = verifyOrderToken(orderNumber, query.t);
  if (!ownsIt && !hasValidToken) notFound();

  const awaitingPayment = order.status === "PENDING_PAYMENT";
  // §48: "Pay now" only inside the window stock is held for.
  const payWindowOpen = canStartPayment(order.placedAt);
  const canPayNow =
    awaitingPayment && order.paymentMethod === "ONLINE" && isRazorpayConfigured() && payWindowOpen;
  const timedOut =
    order.cancelReason === PAYMENT_TIMEOUT_REASON ||
    (awaitingPayment && order.paymentMethod === "ONLINE" && !payWindowOpen);

  return (
    <div className="storefront-shell">
      <Navbar nav={homepage.nav} />

      {/*
        Only when arriving straight from checkout. A customer opening this from
        an email weeks later must not have their current bag emptied.
      */}
      {query.placed === "1" && <OrderPlaced orderNumber={order.orderNumber} />}

      <main id="main" className="pt-[calc(var(--header-h)+2rem)]">
        <div className="mx-auto max-w-3xl px-gutter pb-24 lg:px-gutter-lg">
          <p className="eyebrow">Order {order.orderNumber}</p>
          <h1 className="headline mt-2 text-display-sm">
            {timedOut
              ? "Payment not completed"
              : order.status === "CANCELLED"
                ? "Order cancelled"
                : order.status === "REFUNDED"
                  ? "Order refunded"
                  : order.status === "PENDING_PAYMENT"
                    ? "Order saved"
                    : "Thank you"}
          </h1>

          <p className="mt-3 max-w-prose text-base leading-relaxed text-bone/60">
            {timedOut
              ? order.paidAt
                ? "Your payment arrived after the time to pay had run out and the items were no longer available. We’ll refund it in full — no action needed."
                : "This order wasn’t paid within 30 minutes, so it has been cancelled and nothing was charged. You’re welcome to place it again."
              : order.status === "REFUNDED"
                ? `Your payment has been refunded to the original method. Banks usually take 5–7 working days to show it.`
                : order.status === "CANCELLED"
                  ? order.paidAt
                    ? "This order was cancelled. We’ll refund your payment in full."
                    : "This order was cancelled and nothing was charged."
              : awaitingPayment
              ? canPayNow
                ? "Nothing has been charged yet. Pay below to confirm your order — we’ll hold it in the meantime."
                : "Online payment isn’t available right now, so nothing has been charged. Your order is held and we’ll be in touch."
              : "We’ve got your order. Keep this page — order confirmation emails aren’t set up yet, so this is your record."}
          </p>

          {/*
            The payment button is shown only for an order the database still
            calls PENDING_PAYMENT. That value is set by the webhook, so this
            button disappears when the payment is actually recorded — not when
            the browser thinks it was. See the webhook route for why the
            distinction matters.
          */}
          {awaitingPayment && canPayNow && (
            <RazorpayPayButton
              orderNumber={order.orderNumber}
              token={query.t}
              amount={order.total}
            />
          )}

          <dl className="mt-8 grid gap-4 border-y border-ink-line py-5 sm:grid-cols-3">
            <div>
              <dt className="eyebrow">Status</dt>
              <dd className="mt-1 text-sm text-bone">
                {STATUS_LABELS[order.status] ?? order.status}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Placed</dt>
              <dd className="mt-1 text-sm text-bone">
                {order.placedAt.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Payment</dt>
              <dd className="mt-1 text-sm text-bone">
                {order.paymentMethod === "COD"
                  ? "Cash on delivery"
                  : order.refundedAt
                    ? order.refundStatus === "processed"
                      ? "Online — refunded"
                      : "Online — refund in progress"
                    : order.paidAt
                    ? "Online — paid"
                    : "Online — unpaid"}
              </dd>
            </div>
          </dl>

          {/*
            Tracking, shown only once there is something real to show.
            `courierStatus` is the courier's own wording, kept verbatim — "Out
            for delivery" tells a customer more than any status of ours could,
            and paraphrasing it into our seven-value enum would throw that away.
          */}
          {(order.awb || order.courierStatus) && (
            <section className="mt-8 border border-ink-line px-4 py-4">
              <h2 className="eyebrow">Delivery</h2>
              <p className="mt-2 text-sm text-bone">
                {order.courierStatus ?? "Handed to the courier"}
                {order.courierName ? ` · ${order.courierName}` : ""}
              </p>
              {order.awb && (
                <p className="mt-1 text-xs tabular-nums text-bone/40">AWB {order.awb}</p>
              )}
              {order.trackingUrl && (
                <a
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-label font-bold uppercase text-bone underline underline-offset-4 transition-opacity hover:opacity-70"
                >
                  Track this parcel
                </a>
              )}
            </section>
          )}

          <section className="mt-8">
            <h2 className="eyebrow">Items</h2>
            <ul className="mt-4 divide-y divide-ink-line border-y border-ink-line">
              {order.items.map((item) => (
                <li key={item.id} className="flex gap-4 py-4">
                  <div className="relative aspect-[3/4] w-16 shrink-0 overflow-hidden bg-ink-raised">
                    {/* The image the customer saw, snapshotted with the line. */}
                    <Image
                      src={item.imageSrc}
                      alt={item.imageAlt}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-bone">{item.title}</p>
                    {item.size && (
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-bone/60">
                        Size {item.size}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-bone/40">
                      {formatPaise(item.unitPrice)} &times; {item.quantity}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm tabular-nums text-bone">
                    {formatPaise(item.lineTotal)}
                  </p>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-bone/60">Subtotal</dt>
                <dd className="tabular-nums text-bone">{formatPaise(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-bone/60">Delivery</dt>
                <dd className="tabular-nums text-bone/60">
                  {order.shipping === 0 ? "—" : formatPaise(order.shipping)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-ink-line pt-3">
                <dt className="text-label font-bold uppercase text-bone">Total</dt>
                <dd className="text-lg tabular-nums text-bone">{formatPaise(order.total)}</dd>
              </div>
            </dl>
          </section>

          <section className="mt-8">
            <h2 className="eyebrow">Delivering to</h2>
            <address className="mt-3 text-sm not-italic leading-relaxed text-bone/70">
              <span className="block text-bone">{order.shipName}</span>
              {order.shipLine1}
              {order.shipLine2 ? `, ${order.shipLine2}` : ""}
              <br />
              {order.shipCity}, {order.shipState} {order.shipPincode}
              <br />
              <span className="text-bone/40">{order.shipPhone}</span>
            </address>
            {order.note && (
              <p className="mt-3 max-w-prose whitespace-pre-line text-sm text-bone/50">
                {order.note}
              </p>
            )}
          </section>

          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/products"
              className="text-label font-bold uppercase text-bone underline underline-offset-4 transition-opacity hover:opacity-70"
            >
              Keep shopping
            </Link>
            {ownsIt && (
              <Link
                href="/account"
                className="text-label font-bold uppercase text-bone/50 underline underline-offset-4 transition-colors hover:text-bone"
              >
                All orders
              </Link>
            )}
          </div>
        </div>
      </main>

      <Footer content={homepage.footer} />
      <BottomNav items={homepage.nav.bottomNav} />
    </div>
  );
}
