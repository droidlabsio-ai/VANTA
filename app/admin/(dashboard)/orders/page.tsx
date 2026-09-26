import Link from "next/link";
import { hasDatabase, prisma } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { COURIER_PUSH } from "@/lib/outbox";
import { isShiprocketConfigured } from "@/lib/shipping/shiprocket";
import { Button, Card, CardHeader, Pill } from "@/components/admin/ui";
import { drainQueueAction, rePushOrderAction } from "./actions";
import { RefundButton } from "@/components/admin/RefundButton";
import { expireUnpaidOrders } from "@/lib/payments/expiry";
import { isRazorpayConfigured } from "@/lib/payments/razorpay";
import type { OrderStatusValue } from "@/lib/orderStatus";

/**
 * Orders and shipments.
 *
 * The screen someone stands in front of while packing. It answers three
 * questions in the order they get asked: what needs shipping, what has gone
 * wrong, and where is everything else.
 *
 * Read-only apart from re-pushing. An order is a record of something that
 * happened, and this is not the place to edit one — the status moves because
 * the courier said so, not because a button was pressed.
 */
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "neutral" | "accent" | "muted"> = {
  PENDING_PAYMENT: "muted",
  CONFIRMED: "accent",
  PACKED: "accent",
  SHIPPED: "accent",
  DELIVERED: "neutral",
  CANCELLED: "muted",
  REFUNDED: "muted",
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "to-pack", label: "To pack" },
  { key: "unpaid", label: "Awaiting payment" },
  { key: "shipped", label: "On the way" },
  { key: "done", label: "Delivered" },
  { key: "closed", label: "Cancelled / refunded" },
] as const;

/** What each filter chip means, as a status list (§49). */
const FILTER_STATUSES: Record<string, OrderStatusValue[]> = {
  "to-pack": ["CONFIRMED", "PACKED"],
  unpaid: ["PENDING_PAYMENT"],
  shipped: ["SHIPPED"],
  done: ["DELIVERED"],
  closed: ["CANCELLED", "REFUNDED"],
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const query = await searchParams;
  const q = (query.q ?? "").trim().slice(0, 80);
  const show = FILTER_STATUSES[query.show ?? ""] ? (query.show as string) : "";
  /**
   * One box finds an order by what staff actually have in hand: the order
   * number off a label, a name, an email, a phone number or a pincode.
   */
  const where = {
    ...(show ? { status: { in: FILTER_STATUSES[show] } } : {}),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q, mode: "insensitive" as const } },
            { shipName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { shipPhone: { contains: q } },
            { shipPincode: { contains: q } },
          ],
        }
      : {}),
  };

  if (!hasDatabase()) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Header />
        <Card>
          <div className="p-5">
            <p className="text-sm text-admin-ink">Orders need a database.</p>
            <p className="mt-2 text-sm text-admin-muted">
              Set <code>DATABASE_URL</code> to turn on checkout, orders and
              shipments. Without one the storefront still runs — the bag stays in
              the browser and checkout says it isn&rsquo;t available.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // Unpaid online orders past their window are cancelled and their stock
  // returned before the list is read, so it shows the truth (§48).
  await expireUnpaidOrders();

  const [orders, pendingJobs, failingJobs, unprocessedEvents] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      take: 100,
      select: {
        id: true,
        orderNumber: true,
        placedAt: true,
        status: true,
        paymentMethod: true,
        paidAt: true,
        total: true,
        razorpayPaymentId: true,
        refundedAt: true,
        refundStatus: true,
        cancelReason: true,
        shipName: true,
        shipCity: true,
        shipPincode: true,
        awb: true,
        courierName: true,
        courierStatus: true,
        trackingUrl: true,
        shiprocketOrderId: true,
        courierError: true,
      },
    }),
    prisma.outboxJob.count({ where: { kind: COURIER_PUSH, completedAt: null } }),
    prisma.outboxJob.count({ where: { kind: COURIER_PUSH, completedAt: null, attempts: { gt: 0 } } }),
    /**
     * The reconciliation queue: webhooks that were claimed but never reached a
     * terminal outcome. §29.
     *
     * An unprocessed payment event is the highest-severity thing on this page —
     * it means money may have moved for an order we did not confirm. Ordered
     * oldest first, because the oldest is the one that has been wrong longest.
     */
    prisma.webhookEvent.findMany({
      where: { processedAt: null },
      orderBy: { receivedAt: "asc" },
      take: 20,
      select: {
        id: true,
        provider: true,
        eventType: true,
        eventKey: true,
        attempts: true,
        receivedAt: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Header />

      {!isShiprocketConfigured() && (
        <Card>
          <div className="p-5">
            <p className="text-sm text-admin-ink">The courier isn&rsquo;t connected.</p>
            <p className="mt-2 text-sm text-admin-muted">
              Orders are still taken and still recorded — nothing about the
              storefront depends on Shiprocket. They simply queue here until
              <code className="mx-1">SHIPROCKET_EMAIL</code>,
              <code className="mx-1">SHIPROCKET_PASSWORD</code> and
              <code className="mx-1">SHIPROCKET_PICKUP_LOCATION</code> are set.
            </p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Courier queue"
          hint="Orders waiting to be handed over. They retry on their own; this is for when you don't want to wait."
        />
        <div className="flex flex-wrap items-center gap-4 p-5">
          <p className="text-sm text-admin-muted">
            <span className="font-semibold text-admin-ink">{pendingJobs}</span> waiting
            {failingJobs > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-admin-danger">{failingJobs}</span> retrying
              </>
            )}
          </p>
          <form action={drainQueueAction} className="ml-auto">
            <Button type="submit" disabled={pendingJobs === 0}>
              Push what&rsquo;s waiting
            </Button>
          </form>
        </div>
      </Card>

      {/*
        Shown only when there is something wrong. A card that is empty 99% of
        the time trains people to ignore it, and this is the one thing on the
        page that must not be ignored.
      */}
      {unprocessedEvents.length > 0 && (
        <Card className="border-admin-danger/40">
          <CardHeader
            title="Webhooks needing reconciliation"
            hint="Events that arrived but could not be completed. A payment event here may mean money moved for an order that was never confirmed."
          />
          <div className="p-5">
            <ul className="divide-y divide-admin-border">
              {unprocessedEvents.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                  <Pill tone={event.provider === "razorpay" ? "accent" : "muted"}>
                    {event.provider}
                  </Pill>
                  <span className="text-sm text-admin-ink">{event.eventType ?? "unknown event"}</span>
                  {event.attempts > 1 && (
                    <span className="text-xs font-semibold text-admin-danger">
                      {event.attempts} deliveries
                    </span>
                  )}
                  <span className="text-xs text-admin-muted">
                    {event.receivedAt.toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {/* The event key is what you search the provider's dashboard
                      for, so it is shown in full rather than truncated. */}
                  <span className="w-full break-all font-mono text-[11px] text-admin-muted">
                    {event.eventKey}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-admin-muted">
              These are left deliberately unfinished so the provider keeps
              redelivering them — most clear themselves. One that persists needs
              a look in the provider&rsquo;s dashboard against the key above.
            </p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Orders" hint="The hundred most recent that match. Click an order for everything about it." />
        <div className="flex flex-wrap items-center gap-3 border-b border-admin-border px-5 py-3">
          <form className="flex min-w-0 flex-1 gap-2" role="search">
            {show && <input type="hidden" name="show" value={show} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Order number, name, email, phone or pincode"
              aria-label="Search orders"
              className="min-w-0 flex-1 rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-ink placeholder:text-admin-subtle focus:border-admin-accent focus:outline-none"
            />
            <Button type="submit">Search</Button>
          </form>
          <nav aria-label="Filter orders" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => {
              const params = new URLSearchParams();
              if (f.key) params.set("show", f.key);
              if (q) params.set("q", q);
              const active = f.key === show;
              return (
                <Link
                  key={f.key || "all"}
                  href={`/admin/orders${params.size ? `?${params}` : ""}`}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "rounded-full bg-admin-ink px-3 py-1 text-xs font-semibold text-white"
                      : "rounded-full px-3 py-1 text-xs font-medium text-admin-muted hover:bg-admin-bg hover:text-admin-ink"
                  }
                >
                  {f.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="p-5">
          {orders.length === 0 ? (
            <p className="text-sm text-admin-muted">
              {q || show ? "No orders match. Try a different search or filter." : "No orders yet."}
            </p>
          ) : (
            <ul className="divide-y divide-admin-border">
              {orders.map((order) => (
                <li key={order.id} className="py-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      href={`/admin/orders/${order.orderNumber}`}
                      className="text-sm font-semibold text-admin-ink hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <Pill tone={STATUS_TONE[order.status] ?? "neutral"}>{order.status}</Pill>
                    <Pill tone={order.paymentMethod === "COD" ? "muted" : order.paidAt ? "accent" : "muted"}>
                      {order.paymentMethod === "COD"
                        ? "COD"
                        : order.refundedAt
                          ? order.refundStatus === "processed"
                            ? "Refunded"
                            : order.refundStatus === "failed"
                              ? "Refund failed"
                              : "Refund pending"
                          : order.paidAt
                            ? "Paid"
                            : order.cancelReason === "payment-timeout"
                              ? "Not paid in time"
                              : "Unpaid"}
                    </Pill>
                    {/* Money in, goods not going out: the one state that needs a person. */}
                    {order.paidAt && !order.refundedAt && order.status === "CANCELLED" && (
                      <span className="text-xs font-semibold text-admin-danger">
                        Paid — refund needed
                      </span>
                    )}
                    <span className="text-xs text-admin-muted">
                      {order.placedAt.toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <span className="ml-auto text-sm font-medium tabular-nums text-admin-ink">
                      {formatPaise(order.total)}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-admin-muted">
                    {order.shipName} · {order.shipCity} {order.shipPincode}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {order.awb ? (
                      <span className="text-xs text-admin-muted">
                        {order.courierStatus ?? "Handed over"}
                        {order.courierName ? ` · ${order.courierName}` : ""} ·{" "}
                        {order.trackingUrl ? (
                          <a
                            href={order.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tabular-nums underline"
                          >
                            {order.awb}
                          </a>
                        ) : (
                          <span className="tabular-nums">{order.awb}</span>
                        )}
                      </span>
                    ) : order.shiprocketOrderId ? (
                      <span className="text-xs text-admin-muted">
                        With the courier, no AWB assigned yet
                      </span>
                    ) : (
                      <span className="text-xs text-admin-muted">Not sent to the courier</span>
                    )}

                    {/*
                      The error is shown next to the order it is about, not only
                      in the queue. Whoever notices a parcel has not moved is
                      looking at the order, not at a job table.
                    */}
                    {order.courierError && (
                      <span className="text-xs text-admin-danger">{order.courierError}</span>
                    )}

                    {/*
                      Offered only where it can do something: an order that is
                      already with the courier, unpaid, or closed has nothing to
                      re-push, and a button that quietly does nothing is worse
                      than no button.
                    */}
                    {order.paymentMethod === "ONLINE" &&
                      order.paidAt &&
                      order.razorpayPaymentId &&
                      !order.refundedAt &&
                      isRazorpayConfigured() && (
                        <div className="ml-auto">
                          <RefundButton
                            orderId={order.id}
                            amountLabel={formatPaise(order.total)}
                            restocks={order.status === "CONFIRMED"}
                          />
                        </div>
                      )}

                    {!order.shiprocketOrderId &&
                      order.status !== "PENDING_PAYMENT" &&
                      order.status !== "CANCELLED" &&
                      order.status !== "REFUNDED" && (
                        <form
                          action={rePushOrderAction}
                          // Beside the Refund button when there is one; right-aligned alone otherwise.
                          className={
                            order.paymentMethod === "ONLINE" && order.paidAt && !order.refundedAt
                              ? ""
                              : "ml-auto"
                          }
                        >
                          <input type="hidden" name="orderId" value={order.id} />
                          <Button type="submit" variant="ghost" className="px-3 py-1 text-xs">
                            Send to courier
                          </Button>
                        </form>
                      )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="font-admin-display text-2xl font-bold tracking-tight text-admin-ink">
        Orders &amp; Shipments
      </h1>
      <p className="mt-1 text-sm text-admin-muted">
        What&rsquo;s been bought, what&rsquo;s been paid for, and where it is.
      </p>
    </header>
  );
}
