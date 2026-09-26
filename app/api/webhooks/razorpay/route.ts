import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { hasDatabase, prisma } from "@/lib/db";
import { COURIER_PUSH, enqueue } from "@/lib/outbox";
import { PAYMENT_TIMEOUT_REASON } from "@/lib/payments/expiry";
import { OutOfStockError, reserveStock } from "@/lib/stock";
import {
  HANDLED_EVENTS,
  readWebhookFacts,
  verifyWebhookSignature,
} from "@/lib/payments/razorpay";

/**
 * Razorpay's webhook.
 *
 * ## This, not the browser, decides whether an order is paid
 *
 * Razorpay's checkout hands control back to the browser after a payment, and
 * it is tempting to mark the order paid there — the customer is right in front
 * of you and it takes one line. It is also wrong, and the failure is silent.
 *
 * The browser is not a reliable narrator of a payment:
 *
 * - It may never come back. A UPI payment finishes in a banking app; the
 *   customer's phone rings, they answer it, the tab is gone. The money moved.
 * - The network may drop between the bank's confirmation and our callback.
 * - The callback is a request the customer's machine makes, which means the
 *   customer can make it too — with different arguments. A paid order that
 *   anyone can create by hand is not a paid order.
 *
 * So: **the webhook is the source of truth.** A browser that never comes back
 * must not lose a paid order, and it does not, because Razorpay delivers this
 * event regardless of what the browser did. The return from checkout does
 * nothing but reload the order page and show whatever this handler has
 * already recorded.
 *
 * ## Verify before touching anything
 *
 * The signature is checked against the *raw* body, before parsing, before any
 * database read, before logging anything as an event. This endpoint is public
 * and unauthenticated by nature; an unsigned request is not a payment
 * notification, it is a stranger, and a stranger must not be able to cause so
 * much as a row to be written.
 *
 * ## Idempotent — claim first, complete later
 *
 * Razorpay retries on any non-2xx and can deliver the same event more than
 * once regardless. Every event is recorded in `WebhookEvent` under a unique
 * (provider, eventKey) index, and that insert happens **first**, before any
 * work: an insert that either succeeds or violates a unique constraint is the
 * only thing that beats a concurrent redelivery. A check-then-act read would
 * race, so the database enforces it rather than this code.
 *
 * That much was always right. What was wrong — and this is the bug §29 fixes —
 * is that the row was treated as *completion* rather than as a *claim*. Every
 * exit path below it left the row committed, including the ones that did no
 * work: `unknown-order`, `amount-mismatch`, `no-order-id`, a thrown exception.
 * Razorpay's retry then hit the unique index, got a 200, and stopped. Observed:
 *
 *     delivery 1  -> {"ok":true,"ignored":"unknown-order"}   (row written)
 *     [the order is written a second later]
 *     redelivery  -> {"ok":true,"duplicate":true}            (never processed)
 *     order: PENDING_PAYMENT, paidAt null, no courier job
 *
 * A paid order, silently stuck for ever. So "seen" and "processed" are now two
 * different things:
 *
 * - The insert sets `processedAt: null`. It claims the key; it does not spend
 *   it.
 * - A unique violation reads the existing row. `processedAt` set means a
 *   genuine duplicate — 200, change nothing. `processedAt` null means an
 *   earlier delivery gave up part-way, so `attempts` is incremented and this
 *   delivery *carries on and does the work*.
 * - `processedAt` is stamped only on a terminal outcome: the order reached
 *   CONFIRMED, was already paid, or the event is one we deliberately ignore.
 * - Everything else returns **503** and leaves `processedAt` null, so Razorpay
 *   redelivers and the row stays in the reconciliation queue.
 *
 * On top of all of that, the order update is itself conditional — it only moves
 * an order that is still PENDING_PAYMENT — which is what makes re-processing
 * safe. A second pass over an already-confirmed order updates nothing and
 * cannot re-stamp `paidAt`. That conditional is load-bearing; do not relax it.
 */

/** Node runtime: signature verification needs `node:crypto`. */
export const runtime = "nodejs";
/** Never cached, never prerendered — a POST endpoint with side effects. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  /**
   * Read the body as text and keep it that way.
   *
   * `request.json()` would parse and discard the bytes, and the signature is
   * over the bytes. Re-serialising a parsed object changes key order and
   * whitespace, and the HMAC then never matches — a class of bug that looks
   * like "Razorpay is sending bad signatures".
   */
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    // 400, not 401: there is no authentication to retry with, and Razorpay
    // should not queue redeliveries of something we will never accept.
    return NextResponse.json({ error: "invalid-signature" }, { status: 400 });
  }

  // Only past this line is the request trusted enough to parse.
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const facts = readWebhookFacts(body);
  if (!facts) {
    // Signed by Razorpay but shaped like nothing we recognise. Logged loudly
    // and NOT acknowledged as processed, so their retries keep it visible
    // rather than it disappearing into a 200.
    console.error("[razorpay] signed event in an unrecognised shape", raw.slice(0, 500));
    return NextResponse.json({ error: "unrecognised-payload" }, { status: 422 });
  }

  /**
   * No database means nothing to record against. 503 rather than 200, so
   * Razorpay retries once the site is configured instead of treating a
   * payment as delivered into a void.
   */
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no-database" }, { status: 503 });
  }

  /**
   * The idempotency key.
   *
   * `x-razorpay-event-id` is Razorpay's own per-event identifier and is stable
   * across retries of the same event. When it is absent, a hash of the exact
   * body stands in: two deliveries of the same event have byte-identical
   * bodies, and two genuinely different events do not.
   */
  const eventKey =
    request.headers.get("x-razorpay-event-id") ??
    createHash("sha256").update(raw, "utf8").digest("hex");

  /** Identifies the claim row for every read and write below. */
  const where = { provider_eventKey: { provider: "razorpay", eventKey } };

  /**
   * Claim the key.
   *
   * `attempts: 1` counts this delivery. A unique violation means somebody
   * claimed it already — either a completed run (duplicate, stop) or one that
   * did not finish (take over and carry on).
   */
  try {
    await prisma.webhookEvent.create({
      data: { provider: "razorpay", eventKey, eventType: facts.event, attempts: 1 },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const existing = await prisma.webhookEvent.findUnique({ where });

    if (existing?.processedAt) {
      // Genuinely handled to completion before. 200: success, not conflict.
      return NextResponse.json({ ok: true, duplicate: true });
    }

    /**
     * Claimed but never finished. This is the case the old code could not
     * express: it saw the unique violation, assumed completion, and threw the
     * redelivery away. Now the redelivery is what rescues the payment.
     */
    await prisma.webhookEvent.update({ where, data: { attempts: { increment: 1 } } });
    console.warn(
      `[razorpay] re-processing unfinished event ${eventKey} (${facts.event}), attempt ${
        (existing?.attempts ?? 0) + 1
      }`,
    );
  }

  /** Stamps the claim as complete. Only called on the terminal paths below. */
  const markProcessed = () =>
    prisma.webhookEvent.update({ where, data: { processedAt: new Date() } });

  /**
   * Everything from here can touch the database, and a throw must not consume
   * the claim. An unhandled exception would return 500 — which Razorpay does
   * retry — but the claim row would already exist with `processedAt` null and
   * the *next* delivery would be fine. Catching is still better: it keeps the
   * failure in the log next to the order id it was about.
   */
  try {
    if (!HANDLED_EVENTS.has(facts.event)) {
      // Subscribed to more than we act on, which is fine. Terminal: there is
      // no future delivery of this event we would treat differently.
      await markProcessed();
      return NextResponse.json({ ok: true, ignored: facts.event });
    }

    /**
     * Refund outcomes (§48). A refund started from /admin/orders is recorded
     * with Razorpay's id; these events move its status from "pending" to
     * "processed" or "failed". A refund made in Razorpay's own dashboard has
     * no order here to update, which is fine — terminal either way.
     */
    if (facts.event === "refund.processed" || facts.event === "refund.failed") {
      if (facts.refundId) {
        await prisma.order.updateMany({
          where: { razorpayRefundId: facts.refundId },
          data: { refundStatus: facts.refundStatus ?? facts.event.slice("refund.".length) },
        });
      }
      if (facts.event === "refund.failed") {
        console.error(`[razorpay] refund ${facts.refundId ?? "?"} FAILED — needs attention`);
      }
      await markProcessed();
      return NextResponse.json({ ok: true, refund: facts.refundStatus });
    }

    /**
     * Find the order, by their id first and ours second.
     *
     * `razorpayOrderId` is written by a database call made after their order
     * was created, and that call can fail — see `app/checkout/actions.ts`.
     * When it has, their id maps to nothing here and the payment would be
     * unattributable. `orderNumber` comes back in the event's own `notes` and
     * `receipt` because we put it there at creation, so the mapping survives
     * our database being briefly unavailable. §29.
     */
    let order = facts.orderId
      ? await prisma.order.findUnique({
          where: { razorpayOrderId: facts.orderId },
          select: { id: true, orderNumber: true, status: true, total: true, paidAt: true },
        })
      : null;

    if (!order && facts.orderNumber) {
      order = await prisma.order.findUnique({
        where: { orderNumber: facts.orderNumber },
        select: { id: true, orderNumber: true, status: true, total: true, paidAt: true },
      });

      if (order && facts.orderId) {
        /**
         * Backfill, so every later event about this order resolves directly
         * and this recovery path runs once rather than for ever.
         *
         * Guarded on the column still being null: `razorpayOrderId` is unique,
         * and blindly writing it would throw if a different order already
         * holds that id. `updateMany` makes the guard part of the statement
         * instead of a read followed by a write.
         */
        const backfilled = await prisma.order.updateMany({
          where: { id: order.id, razorpayOrderId: null },
          data: { razorpayOrderId: facts.orderId },
        });
        console.warn(
          `[razorpay] recovered ${order.orderNumber} from notes/receipt; razorpayOrderId ${
            backfilled.count > 0 ? "backfilled" : "already set by another writer"
          } (${facts.orderId})`,
        );
      }
    }

    if (!order) {
      /**
       * Signed, valid, and about an order we cannot find by *either* route.
       *
       * Almost always a race — the payment arrived before the checkout
       * transaction committed — which is exactly why this is retryable. It can
       * also mean another environment shares these Razorpay keys, in which case
       * the retries stop when Razorpay gives up and the row stays in the
       * reconciliation queue for someone to look at.
       */
      console.error(
        `[razorpay] no local order for razorpay_order_id=${facts.orderId ?? "none"} order_number=${
          facts.orderNumber ?? "none"
        } event=${facts.event} — leaving unprocessed for redelivery`,
      );
      return NextResponse.json({ error: "unknown-order", retry: true }, { status: 503 });
    }

    if (facts.event === "payment.failed") {
      /**
       * A failed payment is NOT a cancelled order.
       *
       * A declined card is very often followed by a successful one a minute
       * later against the same Razorpay order. Cancelling here would destroy an
       * order the customer is in the middle of paying for. It stays
       * PENDING_PAYMENT and simply remains unpaid.
       *
       * Terminal for *this event*: a failure that has been noted has been
       * fully handled. The success that may follow is a different event with
       * its own key.
       */
      await markProcessed();
      return NextResponse.json({ ok: true, noted: "payment-failed" });
    }

    /**
     * Paid — but only for the amount we asked for.
     *
     * The amount comes from Razorpay, who got it from the order *we* created
     * server-side, so a mismatch should be impossible. It is checked anyway,
     * because the cost of being wrong is shipping goods for less than they cost
     * and the check is one comparison. Both sides are paise; see
     * `lib/payments/razorpay.ts` for why no conversion happens anywhere.
     *
     * Retryable, not terminal. A mismatch means we could not safely act, not
     * that there is nothing left to do — and consuming the key here would
     * discard a corrected redelivery.
     */
    if (facts.amount !== null && facts.amount !== order.total) {
      console.error(
        `[razorpay] amount mismatch on ${order.orderNumber} (${facts.orderId}): paid ${facts.amount}, expected ${order.total} — leaving unprocessed`,
      );
      return NextResponse.json({ error: "amount-mismatch", retry: true }, { status: 503 });
    }

    /**
     * Conditional on the order still awaiting payment.
     *
     * `updateMany` with the status in the WHERE clause makes this one atomic
     * statement: `payment.captured` and `order.paid` arrive for the same payment
     * and race, and exactly one of them updates a row. The other updates nothing
     * and moves on, rather than both reading PENDING_PAYMENT and both writing.
     *
     * It is also what makes a *re-processed* delivery safe, now that one is
     * possible at all.
     */
    /**
     * The confirm and the courier job commit together (§43).
     *
     * They used to be two statements. If the enqueue failed after the update
     * committed, Razorpay's redelivery found the order already paid, took the
     * "already paid" branch below and marked the event processed — a paid order
     * with no courier job, forever, and nothing on screen to say so. The COD
     * path in `app/checkout/actions.ts` already did this inside one
     * transaction; this now matches it.
     *
     * Queued rather than pushed: this handler owes Razorpay a fast 2xx, and
     * Shiprocket being slow or down must not turn a captured payment into a
     * webhook timeout and a retry storm. See `lib/outbox.ts`.
     */
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: order.id, status: "PENDING_PAYMENT" },
        data: {
          status: "CONFIRMED",
          razorpayPaymentId: facts.paymentId,
          paidAt: new Date(),
        },
      });
      if (result.count > 0) await enqueue(COURIER_PUSH, order.id, tx);
      return result;
    });

    if (updated.count > 0) {
      await markProcessed();
      return NextResponse.json({ ok: true, updated: updated.count });
    }

    /**
     * Nothing moved, which has two very different causes. Re-read rather than
     * trusting the snapshot taken before the update — a sibling event
     * (`payment.captured` and `order.paid` both arrive) may have confirmed it
     * in between, and treating that as unpaid would park a perfectly good
     * payment in the reconciliation queue.
     */
    const current = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, paidAt: true, shiprocketOrderId: true },
    });

    if (current?.paidAt) {
      // Already recorded as paid — by an earlier delivery or by its sibling
      // event. Terminal, and `paidAt` deliberately keeps its original value.
      //
      // Make sure it can still ship. An order confirmed before the transaction
      // above existed may have lost its job; `enqueue` is a no-op when one is
      // already waiting, and a job for an order that has already been pushed
      // completes without calling the courier (`pushOrderToCourier`).
      if (!current.shiprocketOrderId && current.status === "CONFIRMED") {
        await enqueue(COURIER_PUSH, order.id);
      }
      await markProcessed();
      return NextResponse.json({ ok: true, updated: 0, alreadyPaid: true });
    }

    /**
     * Money arrived for an order that is no longer waiting for it. §48.
     *
     * The usual cause is a slow payment on an order the expiry sweep already
     * cancelled (`lib/payments/expiry.ts`) — the shopper paid, just late. If
     * its sizes can still be taken, the order simply goes ahead: confirmed,
     * stock taken again, queued for the courier, as if it had been on time.
     *
     * Otherwise — sizes gone, or an order a person cancelled — the payment is
     * written onto the order (`paidAt`, payment id) and the order stays
     * cancelled. /admin/orders lists it as "Paid — refund needed" with a
     * Refund button. Until §48 this returned 503 and relied on Razorpay's
     * retries to keep it visible; now there is a button that fixes it, the
     * order itself is the better place for it to wait.
     */
    const late = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, cancelReason: true, paidAt: true },
    });
    if (!late) {
      return NextResponse.json({ error: "order-vanished", retry: true }, { status: 503 });
    }

    let revived = false;
    if (late.status === "CANCELLED" && late.cancelReason === PAYMENT_TIMEOUT_REASON) {
      try {
        revived = await prisma.$transaction(async (tx) => {
          const claimed = await tx.order.updateMany({
            where: { id: order.id, status: "CANCELLED", paidAt: null },
            data: {
              status: "CONFIRMED",
              razorpayPaymentId: facts.paymentId,
              paidAt: new Date(),
              cancelledAt: null,
              cancelReason: null,
            },
          });
          if (claimed.count === 0) return false;
          const items = await tx.orderItem.findMany({
            where: { orderId: order.id },
            select: { sku: true, quantity: true },
          });
          await reserveStock(tx, items);
          await enqueue(COURIER_PUSH, order.id, tx);
          return true;
        });
      } catch (error) {
        if (!(error instanceof OutOfStockError)) throw error;
        revived = false;
      }
    }

    if (revived) {
      console.warn(`[razorpay] late payment revived ${order.orderNumber}`);
      await markProcessed();
      return NextResponse.json({ ok: true, revived: true });
    }

    await prisma.order.updateMany({
      where: { id: order.id, paidAt: null },
      data: { razorpayPaymentId: facts.paymentId, paidAt: new Date() },
    });
    console.error(
      `[razorpay] payment for ${order.orderNumber} which is ${late.status} — recorded, REFUND NEEDED`,
    );
    await markProcessed();
    return NextResponse.json({ ok: true, refundNeeded: true });
  } catch (error) {
    /**
     * The claim stays unprocessed, so Razorpay's redelivery re-runs the work
     * rather than being waved through as a duplicate.
     */
    console.error(
      `[razorpay] failed processing event ${eventKey} (${facts.event}) for razorpay_order_id=${
        facts.orderId ?? "none"
      }:`,
      error,
    );
    return NextResponse.json({ error: "processing-failed", retry: true }, { status: 503 });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
