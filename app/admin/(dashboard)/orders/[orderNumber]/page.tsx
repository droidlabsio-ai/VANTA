import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasDatabase, prisma } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { isRazorpayConfigured } from "@/lib/payments/razorpay";
import { NEXT_STEP, STATUS_LABEL, STOCK_STILL_HERE, canCancel } from "@/lib/orderStatus";
import { Button, Card, CardHeader, Pill, TextInput } from "@/components/admin/ui";
import { RefundButton } from "@/components/admin/RefundButton";
import { CancelOrderButton } from "@/components/admin/CancelOrderButton";
import { advanceOrderAction, rePushOrderAction } from "../actions";

/**
 * One order, everything about it, on one screen (§49).
 *
 * Before this, the list linked to the *customer's* order page, which needs the
 * customer's session or signed link — so staff got "not found". This page is
 * the packing-table view: what to pick (with sizes and SKUs), who it goes to,
 * whether it is paid, where it is, and the one or two things that can be done
 * to it next.
 */
export const dynamic = "force-dynamic";

const when = (date: Date | null) =>
  date
    ? date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  if (!hasDatabase()) notFound();

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { items: { orderBy: { title: "asc" } }, customer: { select: { name: true } } },
  });
  if (!order) notFound();

  const next = NEXT_STEP[order.status];
  const paidOnline = order.paymentMethod === "ONLINE" && Boolean(order.paidAt);
  const refundable =
    paidOnline && Boolean(order.razorpayPaymentId) && !order.refundedAt && isRazorpayConfigured();
  const cancellable = canCancel(order);
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);

  const timeline = [
    { label: "Placed", at: order.placedAt },
    { label: "Paid", at: order.paidAt },
    { label: "Sent to courier", at: order.pushedToCourierAt },
    { label: "Cancelled", at: order.cancelledAt },
    { label: "Refunded", at: order.refundedAt },
  ].filter((t) => t.at);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <Link href="/admin/orders" className="text-xs font-medium text-admin-accent hover:underline">
            ← All orders
          </Link>
          <h1 className="mt-1 font-admin-display text-2xl font-bold tracking-tight text-admin-ink">
            {order.orderNumber}
          </h1>
          <p className="mt-1 text-sm text-admin-muted">
            {when(order.placedAt)} · {itemCount} {itemCount === 1 ? "item" : "items"} ·{" "}
            {formatPaise(order.total)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="accent">{STATUS_LABEL[order.status]}</Pill>
          <Pill tone={order.paymentMethod === "COD" ? "muted" : paidOnline ? "accent" : "muted"}>
            {order.paymentMethod === "COD" ? "Cash on delivery" : paidOnline ? "Paid online" : "Not paid"}
          </Pill>
        </div>
      </header>

      {order.status === "CANCELLED" && paidOnline && !order.refundedAt && (
        <Card className="border-admin-danger/40">
          <p className="p-5 text-sm font-semibold text-admin-danger">
            Paid — refund needed. The customer paid, but this order is cancelled.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="What to pack" hint="Sizes and SKUs as ordered." />
            <ul className="divide-y divide-admin-border">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md bg-admin-bg">
                    <Image src={item.imageSrc} alt={item.imageAlt} fill sizes="48px" className="object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-admin-ink">{item.title}</p>
                    <p className="mt-0.5 text-xs text-admin-muted">
                      {item.size ? (
                        <span className="font-semibold text-admin-ink">Size {item.size}</span>
                      ) : (
                        "No size recorded"
                      )}
                      {item.sku ? ` · ${item.sku}` : ""}
                    </p>
                  </div>
                  <p className="text-sm tabular-nums text-admin-ink">
                    {item.quantity} × {formatPaise(item.unitPrice)}
                  </p>
                  <p className="w-24 text-right text-sm font-semibold tabular-nums text-admin-ink">
                    {formatPaise(item.lineTotal)}
                  </p>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-admin-border px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-admin-muted">Subtotal</dt>
                <dd className="tabular-nums text-admin-ink">{formatPaise(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-admin-muted">Shipping</dt>
                <dd className="tabular-nums text-admin-ink">{formatPaise(order.shipping)}</dd>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-admin-muted">Discount</dt>
                  <dd className="tabular-nums text-admin-ink">−{formatPaise(order.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between pt-1 font-semibold">
                <dt className="text-admin-ink">Total</dt>
                <dd className="tabular-nums text-admin-ink">{formatPaise(order.total)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Delivery" />
            <div className="grid gap-6 p-5 sm:grid-cols-2">
              <div className="text-sm leading-relaxed text-admin-ink">
                <p className="font-semibold">{order.shipName}</p>
                <p>{order.shipLine1}</p>
                {order.shipLine2 && <p>{order.shipLine2}</p>}
                <p>
                  {order.shipCity}, {order.shipState} {order.shipPincode}
                </p>
                <p className="mt-2">
                  <a href={`tel:${order.shipPhone}`} className="text-admin-accent hover:underline">
                    {order.shipPhone}
                  </a>
                </p>
                <p>
                  <a href={`mailto:${order.email}`} className="break-all text-admin-accent hover:underline">
                    {order.email}
                  </a>
                </p>
                <p className="mt-2 text-xs text-admin-muted">
                  {order.customerId ? `Account${order.customer?.name ? `: ${order.customer.name}` : ""}` : "Guest checkout"}
                </p>
              </div>
              <div className="text-sm text-admin-ink">
                {order.awb || order.courierStatus ? (
                  <>
                    <p>{order.courierStatus ?? "Handed to the courier"}</p>
                    {order.courierName && <p className="text-admin-muted">{order.courierName}</p>}
                    {order.awb && <p className="tabular-nums text-admin-muted">AWB {order.awb}</p>}
                    {order.trackingUrl && (
                      <a
                        href={order.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-admin-accent hover:underline"
                      >
                        Tracking page
                      </a>
                    )}
                  </>
                ) : order.shiprocketOrderId ? (
                  <p className="text-admin-muted">With Shiprocket, no AWB yet.</p>
                ) : (
                  <p className="text-admin-muted">Not sent to a courier yet.</p>
                )}
                {order.courierError && <p className="mt-2 text-xs text-admin-danger">{order.courierError}</p>}
              </div>
            </div>
            {order.note && (
              <div className="border-t border-admin-border px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-subtle">
                  Customer note
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-admin-ink">{order.note}</p>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Next step" />
            <div className="space-y-4 p-5">
              {next ? (
                <form action={advanceOrderAction} className="space-y-3">
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="from" value={order.status} />
                  <input type="hidden" name="to" value={next.to} />
                  {next.to === "SHIPPED" && !order.awb && (
                    <div className="space-y-2">
                      <p className="text-xs text-admin-muted">
                        Booked by hand? Add the tracking so the customer sees it. Optional.
                      </p>
                      <TextInput name="courierName" placeholder="Courier, e.g. Delhivery" maxLength={80} />
                      <TextInput name="awb" placeholder="AWB / tracking number" maxLength={64} />
                      <TextInput name="trackingUrl" placeholder="Tracking link (https://…)" maxLength={500} />
                    </div>
                  )}
                  <Button type="submit" variant="primary" className="w-full">
                    {next.label}
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-admin-muted">
                  {order.status === "PENDING_PAYMENT"
                    ? "Waiting for the customer to pay. Unpaid orders cancel themselves after an hour."
                    : "Nothing further to do."}
                </p>
              )}

              {!order.shiprocketOrderId &&
                (order.status === "CONFIRMED" || order.status === "PACKED") && (
                  <form action={rePushOrderAction}>
                    <input type="hidden" name="orderId" value={order.id} />
                    <Button type="submit" className="w-full">
                      Send to courier (Shiprocket)
                    </Button>
                  </form>
                )}

              {(refundable || cancellable) && (
                <div className="border-t border-admin-border pt-4">
                  {refundable ? (
                    <RefundButton
                      orderId={order.id}
                      amountLabel={formatPaise(order.total)}
                      restocks={STOCK_STILL_HERE.has(order.status) && order.status !== "PENDING_PAYMENT"}
                    />
                  ) : (
                    <CancelOrderButton orderId={order.id} courierBooked={Boolean(order.shiprocketOrderId)} />
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Payment" />
            <dl className="space-y-2 p-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-admin-muted">Method</dt>
                <dd className="text-admin-ink">{order.paymentMethod === "COD" ? "Cash on delivery" : "Online"}</dd>
              </div>
              {order.razorpayPaymentId && (
                <div className="flex justify-between gap-4">
                  <dt className="text-admin-muted">Payment</dt>
                  <dd className="break-all font-mono text-xs text-admin-ink">{order.razorpayPaymentId}</dd>
                </div>
              )}
              {order.razorpayRefundId && (
                <div className="flex justify-between gap-4">
                  <dt className="text-admin-muted">Refund</dt>
                  <dd className="text-right text-admin-ink">
                    <span className="block break-all font-mono text-xs">{order.razorpayRefundId}</span>
                    <span className="text-xs text-admin-muted">{order.refundStatus ?? "pending"}</span>
                  </dd>
                </div>
              )}
              {order.cancelReason && (
                <div className="flex justify-between gap-4">
                  <dt className="text-admin-muted">Cancelled</dt>
                  <dd className="text-right text-admin-ink">
                    {order.cancelReason === "payment-timeout" ? "Not paid in time" : order.cancelReason}
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <ol className="space-y-2 p-5 text-sm">
              {timeline.map((t) => (
                <li key={t.label} className="flex justify-between gap-4">
                  <span className="text-admin-muted">{t.label}</span>
                  <span className="text-right tabular-nums text-admin-ink">{when(t.at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
