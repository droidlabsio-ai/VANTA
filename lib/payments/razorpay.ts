import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay.
 *
 * Built against their documentation, not from memory:
 * - Orders API — `POST https://api.razorpay.com/v1/orders`, Basic auth with
 *   key id and secret, `amount` in the smallest currency sub-unit (paise for
 *   INR), `receipt` max 40 characters and unique.
 *   https://razorpay.com/docs/api/orders/create/
 * - Webhook signatures — HMAC SHA-256 over the **raw request body** with the
 *   webhook secret as the key, compared against `X-Razorpay-Signature`.
 *   https://razorpay.com/docs/webhooks/validate-test/
 *
 * One thing could **not** be confirmed from the docs: the exact nesting of the
 * event payload (`payload.payment.entity`). Those pages 404 at the time of
 * writing. Rather than guess a shape and have it silently mismatch, the parser
 * below reads the entity defensively from the plausible paths and returns null
 * if it finds nothing recognisable — a webhook that cannot be understood is
 * logged and left unacknowledged rather than acted on. Confirm against a real
 * test event before going live.
 */

const ORDERS_URL = "https://api.razorpay.com/v1/orders";
const PAYMENTS_URL = "https://api.razorpay.com/v1/payments";

/** Their API is not allowed to hold a checkout open indefinitely. */
const TIMEOUT_MS = 10_000;

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** The publishable half. Safe in the browser; the secret never is. */
export function razorpayKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID ?? null;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export type RazorpayResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Creates a Razorpay order.
 *
 * `amount` is paise, which is already how orders are stored — no conversion,
 * and deliberately so: a unit change between our total and theirs is exactly
 * where a factor-of-100 bug lives.
 *
 * `receipt` carries our own order number so a payment can be traced back
 * without consulting our database, which matters when reconciling from their
 * dashboard.
 */
export async function createRazorpayOrder(input: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayResult<RazorpayOrder>> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return { ok: false, error: "not-configured" };

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  try {
    const response = await fetch(ORDERS_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: "INR",
        // Their limit is 40 characters; ours are 15, but truncating here means
        // a longer scheme later fails their validation rather than ours.
        receipt: input.receipt.slice(0, 40),
        notes: input.notes ?? {},
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      // Their error body is JSON but its shape varies; the status is the part
      // worth acting on, and the body is worth logging, not parsing.
      return { ok: false, error: `razorpay-http-${response.status}` };
    }

    const order = (await response.json()) as Partial<RazorpayOrder>;
    if (!order.id) return { ok: false, error: "razorpay-no-order-id" };

    return {
      ok: true,
      value: {
        id: order.id,
        amount: Number(order.amount ?? input.amountPaise),
        currency: String(order.currency ?? "INR"),
        status: String(order.status ?? "created"),
      },
    };
  } catch {
    return { ok: false, error: "razorpay-unreachable" };
  }
}

/**
 * Verifies a webhook signature.
 *
 * Takes the **raw** body string. Parsing and re-serialising before signing
 * changes whitespace and key order, and the signature then never matches —
 * which is why the route handler reads `request.text()` and parses afterwards.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  try {
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface RazorpayWebhookFacts {
  event: string;
  /** Present on `refund.*` events (§48). */
  refundId: string | null;
  refundStatus: string | null;
  /** Their payment id, when the event carries one. */
  paymentId: string | null;
  /** Their order id, which is how we find ours. */
  orderId: string | null;
  /**
   * **Our** order number (`VNT-2026-00042`), when the event carries it.
   *
   * The recovery path for a payment we cannot otherwise attribute. `Order.
   * razorpayOrderId` is written by a database call made *after* their order
   * exists, and that call can fail — leaving a payable Razorpay order with no
   * local mapping. When it does, `orderId` above matches nothing.
   *
   * This is why `createRazorpayOrder` sends both `receipt: orderNumber` and
   * `notes: { orderNumber }`: the mapping also lives on Razorpay's side, where
   * our database being briefly unavailable cannot touch it. Reading it back
   * here is what makes that redundancy usable rather than decorative. §29.
   */
  orderNumber: string | null;
  /** Paise, so it can be checked against what we expected to be paid. */
  amount: number | null;
}

/**
 * Pulls the facts we act on out of an event.
 *
 * Deliberately tolerant about where they live. The envelope is documented as
 * `{ event, payload: { <entity>: { entity: {...} } } }`, but the payload pages
 * were unreachable, so this looks in the documented place *and* the obvious
 * alternatives rather than hard-coding one guess that might silently miss.
 *
 * Returns null when nothing recognisable is found, so the caller can refuse to
 * act rather than act on an empty object.
 */
export function readWebhookFacts(body: unknown): RazorpayWebhookFacts | null {
  if (typeof body !== "object" || body === null) return null;
  const root = body as Record<string, unknown>;

  const event = typeof root.event === "string" ? root.event : null;
  if (!event) return null;

  const payload = (root.payload ?? {}) as Record<string, unknown>;

  /** `payload.payment.entity`, falling back to `payload.payment`. */
  const entityFrom = (key: string): Record<string, unknown> | null => {
    const wrapper = payload[key];
    if (typeof wrapper !== "object" || wrapper === null) return null;
    const inner = (wrapper as Record<string, unknown>).entity;
    if (typeof inner === "object" && inner !== null) return inner as Record<string, unknown>;
    return wrapper as Record<string, unknown>;
  };

  const payment = entityFrom("payment");
  const refund = entityFrom("refund");
  const order = entityFrom("order");

  const str = (value: unknown): string | null => {
    if (typeof value === "string") return value.trim() || null;
    return null;
  };
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  /**
   * Our order number, wherever they put it back.
   *
   * `notes` is an arbitrary key/value map they echo verbatim, and `receipt` is
   * a documented field on the order entity — we set both at creation, so
   * either will do. Both entities are checked because which one an event
   * carries depends on the event type, and the payload nesting is still
   * unconfirmed against a real delivery (see the note at the top of this file):
   * the same tolerance that applies to everything else here applies to this.
   */
  const orderNumberFrom = (entity: Record<string, unknown> | null): string | null => {
    if (!entity) return null;
    const notes = entity.notes;
    const fromNotes =
      typeof notes === "object" && notes !== null
        ? str((notes as Record<string, unknown>).orderNumber)
        : null;
    return fromNotes ?? str(entity.receipt);
  };

  return {
    event,
    refundId: refund ? str(refund.id) : null,
    refundStatus: refund ? str(refund.status) : null,
    paymentId: (payment ? str(payment.id) : null) ?? (refund ? str(refund.payment_id) : null),
    // `order_id` lives on the payment entity; `id` on the order entity. Either
    // is the same order as far as we are concerned.
    orderId: (payment ? str(payment.order_id) : null) ?? (order ? str(order.id) : null),
    orderNumber: orderNumberFrom(payment) ?? orderNumberFrom(order),
    amount: (payment ? num(payment.amount) : null) ?? (order ? num(order.amount) : null),
  };
}

/** Events worth acting on. Anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = new Set([
  "payment.captured",
  "payment.failed",
  "order.paid",
  "refund.processed",
  "refund.failed",
]);

/* ------------------------------------------------------------------------ */
/* Refunds (§48)                                                             */
/* ------------------------------------------------------------------------ */

export interface RazorpayRefund {
  id: string;
  amount: number;
  /** "pending" | "processed" | "failed" — their words, stored as given. */
  status: string;
}

function basicAuth(): string | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

function asRefund(value: unknown): RazorpayRefund | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    amount: typeof r.amount === "number" ? r.amount : 0,
    status: typeof r.status === "string" ? r.status : "pending",
  };
}

/**
 * Refunds a captured payment in full or in part.
 *
 * `receipt` is Razorpay's idempotency key for refunds: a second request with
 * the same receipt is refused instead of paying out twice. We send
 * `refund-<orderNumber>`, so a double click, a retry after a timeout, or two
 * admins pressing at once can never refund one order twice. When Razorpay
 * says the receipt is taken, the refund it already made is looked up and
 * returned — that is the "our first call worked but we never heard back"
 * case, and the order must still be recorded as refunded.
 *
 * https://razorpay.com/docs/api/refunds/create-normal/
 */
export async function createRefund(input: {
  paymentId: string;
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayResult<RazorpayRefund>> {
  const auth = basicAuth();
  if (!auth) return { ok: false, error: "not-configured" };

  try {
    const response = await fetch(
      `${PAYMENTS_URL}/${encodeURIComponent(input.paymentId)}/refund`,
      {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({
          amount: input.amountPaise,
          speed: "normal",
          receipt: input.receipt.slice(0, 40),
          notes: input.notes ?? {},
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );

    if (response.ok) {
      const refund = asRefund(await response.json().catch(() => null));
      return refund ? { ok: true, value: refund } : { ok: false, error: "razorpay-no-refund-id" };
    }

    const detail = await response.text().catch(() => "");
    if (response.status === 400 && /receipt/i.test(detail)) {
      const existing = await findRefundByReceipt(input.paymentId, input.receipt);
      if (existing) return { ok: true, value: existing };
    }
    console.error(`[razorpay] refund failed: http ${response.status} ${detail.slice(0, 300)}`);
    return { ok: false, error: refundErrorMessage(detail) };
  } catch {
    return { ok: false, error: "Couldn’t reach Razorpay. Nothing was refunded — try again." };
  }
}

async function findRefundByReceipt(
  paymentId: string,
  receipt: string,
): Promise<RazorpayRefund | null> {
  const auth = basicAuth();
  if (!auth) return null;
  try {
    const response = await fetch(`${PAYMENTS_URL}/${encodeURIComponent(paymentId)}/refunds`, {
      headers: { authorization: auth },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { items?: unknown[] } | null;
    const match = body?.items?.find(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).receipt === receipt,
    );
    return asRefund(match);
  } catch {
    return null;
  }
}

/** Razorpay's own description when it gave one — "fully refunded already" says more than a status code. */
function refundErrorMessage(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { description?: unknown } };
    if (typeof parsed.error?.description === "string") return parsed.error.description;
  } catch {
    // Not JSON: fall through.
  }
  return "Razorpay refused the refund. Nothing was refunded.";
}
