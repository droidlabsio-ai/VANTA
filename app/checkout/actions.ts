"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hasDatabase, prisma } from "@/lib/db";
import { getCustomer } from "@/lib/auth/customerSession";
import { checkoutSchema, type CheckoutFormState } from "@/lib/checkoutSchema";
import { fieldErrors } from "@/lib/auth/accountSchema";
import { generateOrderNumber, guestOrderPath, priceBag } from "@/lib/orders";
import { COURIER_PUSH, enqueue } from "@/lib/outbox";
import { createRazorpayOrder, isRazorpayConfigured } from "@/lib/payments/razorpay";
import { checkAll, rateLimitKey, recordFailureAll } from "@/lib/rateLimit";
import { TURNSTILE_FIELD, verifyTurnstileIfConfigured } from "@/lib/turnstile";
import { headers } from "next/headers";

/**
 * Placing an order.
 *
 * Every rule here exists because a Server Action is a public POST endpoint with
 * a hard-to-guess name — the Next docs are explicit that it must be treated as
 * an untrusted entry point. The button being behind a checkout page protects
 * nothing.
 */

const NO_DATABASE = "Checkout isn’t available right now. Please try again shortly.";

/** Re-read here so a stale tab cannot place an order at yesterday's price. */
function parseLines(raw: FormDataEntryValue | null): Array<{ productId: string; quantity: number }> {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const productId = typeof entry?.productId === "string" ? entry.productId : "";
      const quantity = Number(entry?.quantity);
      return productId && Number.isFinite(quantity) && quantity > 0
        ? [{ productId, quantity: Math.floor(quantity) }]
        : [];
    });
  } catch {
    return [];
  }
}

/**
 * Abuse limits on placing orders (§43).
 *
 * Checkout had neither a rate limit nor a captcha, unlike sign-in and
 * registration. A guest COD order is created CONFIRMED and queued for the
 * courier with nothing more than a form post, so a script could fill the
 * orders table and — once Shiprocket is live — book real pickups that end as
 * return-to-origin charges.
 *
 * The limiter is the same Postgres bucket sign-in uses, keyed on IP and on the
 * email, and here it counts orders *placed* (plus failed captchas) rather than
 * failed passwords: five in fifteen minutes from one IP or one email, then a
 * lockout that doubles on repeat. Nobody shopping for themselves places a sixth
 * order in a quarter of an hour. Fails **open**, like the customer forms: a
 * database blip must not block a real sale (§25).
 */
const CHECKOUT_SCOPE = "checkout";
const CHECKOUT_FAIL_MODE = "open" as const;

async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() ?? headerList.get("x-real-ip") ?? "unknown";
}

function tooManyOrders(retryAfterSeconds: number): CheckoutFormState {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return {
    errors: {
      form: `Too many orders from here in a short time. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or contact us if you need to place a large order.`,
    },
  };
}

export async function createOrder(
  _previous: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  if (!hasDatabase()) return { errors: { form: NO_DATABASE } };

  /**
   * The caller is established from the session, never from the form.
   *
   * A `customerId` field would let anyone place orders against someone else's
   * account. Null here simply means guest, which is a supported case.
   */
  const customer = await getCustomer();

  const rawAddress = {
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    line1: formData.get("line1"),
    line2: formData.get("line2") || undefined,
    city: formData.get("city"),
    state: formData.get("state"),
    pincode: formData.get("pincode"),
  };
  const savedAddressId = String(formData.get("savedAddressId") ?? "").trim();

  const parsed = checkoutSchema.safeParse({
    email: formData.get("email") ?? customer?.email ?? "",
    lines: parseLines(formData.get("lines")),
    paymentMethod: formData.get("paymentMethod"),
    savedAddressId: savedAddressId || undefined,
    // Only validate the typed address when no saved one was chosen, or an empty
    // set of fields would fail validation for someone who picked from the book.
    address: savedAddressId ? undefined : rawAddress,
    note: formData.get("note") || undefined,
    saveAddress: formData.get("saveAddress") === "on",
  });

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const input = parsed.data;

  const ip = await clientIp();
  const limitKeys = [
    rateLimitKey.ip(CHECKOUT_SCOPE, ip),
    rateLimitKey.identifier(CHECKOUT_SCOPE, input.email),
  ];
  const limit = await checkAll(limitKeys, CHECKOUT_FAIL_MODE);
  if (!limit.allowed) return tooManyOrders(limit.retryAfterSeconds);

  /**
   * A saved address is resolved scoped to the signed-in customer.
   *
   * The id arrives from a form, so it is a hint, not authorisation. Looking it
   * up unscoped would let anyone ship an order to an address belonging to
   * someone else — and, worse, read it back off the order page afterwards.
   */
  let ship = input.address;
  if (input.savedAddressId) {
    if (!customer) return { errors: { form: "Sign in to use a saved address." } };
    const saved = await prisma.address.findFirst({
      where: { id: input.savedAddressId, customerId: customer.id },
    });
    if (!saved) return { errors: { address: "That address is no longer available." } };
    ship = {
      fullName: saved.fullName,
      phone: saved.phone,
      line1: saved.line1,
      line2: saved.line2 ?? undefined,
      city: saved.city,
      state: saved.state,
      pincode: saved.pincode,
    };
  }
  if (!ship) return { errors: { address: "Choose a delivery address." } };

  /**
   * Priced again, here, from the catalogue.
   *
   * The summary the customer just looked at was rendered from an earlier read.
   * This is the read that decides, so a price changed in /admin in between is
   * caught rather than honoured.
   */
  const priced = await priceBag(input.lines);

  if (priced.unavailable.length > 0) {
    return {
      errors: {
        form:
          priced.unavailable.length === 1
            ? "One item in your bag is no longer available. Go back and review it."
            : `${priced.unavailable.length} items in your bag are no longer available. Go back and review them.`,
      },
    };
  }
  if (priced.lines.length === 0) return { errors: { form: "Your bag is empty." } };

  /**
   * The captcha is checked last, after everything that can be corrected on the
   * form. A token is single-use: spending it on a submit that then fails on a
   * phone-number typo would make the retry fail too. Skipped when Turnstile is
   * not configured, as on the other customer forms, so local development works
   * without a Cloudflare account.
   */
  const captcha = await verifyTurnstileIfConfigured(
    String(formData.get(TURNSTILE_FIELD) ?? ""),
    ip === "unknown" ? null : ip,
  );
  if (!captcha.ok) {
    await recordFailureAll(limitKeys, CHECKOUT_FAIL_MODE);
    return {
      errors: { form: "Couldn’t verify that you’re human. Please try again." },
    };
  }

  /**
   * ONLINE stops at PENDING_PAYMENT, and only the webhook moves it on.
   *
   * Nothing in this action — and nothing the browser does after it — marks an
   * order paid. Razorpay's webhook does, because it is the only participant
   * that hears about the payment whether or not the customer's tab survives.
   * See `app/api/webhooks/razorpay/route.ts`.
   */
  const status = input.paymentMethod === "COD" ? "CONFIRMED" : "PENDING_PAYMENT";

  let orderNumber = "";
  let orderId = "";

  /**
   * Retried on a duplicate order number.
   *
   * `generateOrderNumber` counts this year's orders, which races under
   * concurrent checkouts. The unique index is what makes that safe: a
   * collision fails the insert instead of producing two orders sharing a
   * number, and the retry picks up the now-higher count.
   */
  for (let attempt = 0; attempt < 5; attempt++) {
    orderNumber = await generateOrderNumber();
    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            orderNumber,
            customerId: customer?.id ?? null,
            email: input.email,
            status,
            paymentMethod: input.paymentMethod,
            shipName: ship.fullName,
            shipPhone: ship.phone,
            shipLine1: ship.line1,
            shipLine2: ship.line2 ?? null,
            shipCity: ship.city,
            shipState: ship.state,
            shipPincode: ship.pincode,
            subtotal: priced.subtotal,
            shipping: priced.shipping,
            discount: priced.discount,
            total: priced.total,
            note: input.note ?? null,
            // Written in the same transaction as the order: an order with no
            // lines is not a lesser order, it is a corrupt one.
            items: {
              create: priced.lines.map((line) => ({
                productId: line.productId,
                title: line.title,
                imageSrc: line.imageSrc,
                imageAlt: line.imageAlt,
                unitPrice: line.unitPrice,
                quantity: line.quantity,
                lineTotal: line.lineTotal,
              })),
            },
          },
        });
        orderId = created.id;

        /**
         * A COD order is confirmed the moment it is written, so it can be
         * handed to the courier immediately — but the handing over is queued,
         * inside this transaction, not performed here.
         *
         * If it were performed here, Shiprocket being slow would make checkout
         * slow, and Shiprocket being down would fail the order. Neither is
         * acceptable: the customer has decided to buy, and a courier's
         * availability has nothing to do with whether we accept that. The job
         * commits with the order or not at all. See `lib/outbox.ts`.
         */
        if (status === "CONFIRMED") {
          await enqueue(COURIER_PUSH, created.id, tx);
        }

        /**
         * The server-side bag mirror is cleared inside the transaction.
         *
         * If it were cleared afterwards and that failed, the customer would
         * have an order and a full bag, and their next device sync would put
         * the just-bought items back. The client store is cleared separately by
         * the confirmation page — see `components/OrderPlaced.tsx`.
         */
        if (customer) {
          await tx.bagLine.deleteMany({ where: { customerId: customer.id } });
        }

        // Keeping a newly typed address is a convenience, not part of the
        // order, so it never blocks the sale — but it does belong in the same
        // transaction, or a failure here leaves a saved address for an order
        // that was rolled back.
        if (customer && input.saveAddress && !input.savedAddressId) {
          const existing = await tx.address.count({ where: { customerId: customer.id } });
          await tx.address.create({
            data: {
              customerId: customer.id,
              fullName: ship.fullName,
              phone: ship.phone,
              line1: ship.line1,
              line2: ship.line2 ?? null,
              city: ship.city,
              state: ship.state,
              pincode: ship.pincode,
              isDefault: existing === 0,
            },
          });
        }
      });
      break;
    } catch (error) {
      const isDuplicate =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002";
      if (isDuplicate && attempt < 4) continue;
      return { errors: { form: "Couldn’t place your order. Please try again." } };
    }
  }

  // Counted only once the order exists, so a failed attempt does not use up
  // the allowance. The result is not checked: this order is placed regardless,
  // and the limit applies to the next one.
  await recordFailureAll(limitKeys, CHECKOUT_FAIL_MODE);

  /**
   * The payment handoff, attempted after the order exists.
   *
   * Order matters, but less than §27 originally claimed. Ours is written first
   * and theirs second, so there can never be a Razorpay order for an order that
   * was rolled back — theirs is only created once ours has committed. That is
   * the whole of what the ordering buys.
   *
   * It does NOT prevent a live, payable Razorpay order with nothing on our side
   * pointing at it. That gap is the linking write below, which used to swallow
   * its own failure; §29 retracted the stronger claim and closed it. Read the
   * comment on that write for what actually protects the payment now.
   *
   * And it is best-effort. If Razorpay is unreachable right now the order is
   * still placed, still visible, and the order page offers to start the
   * payment again — `app/orders/[orderNumber]/actions.ts`. Losing the sale
   * because a third party had a bad thirty seconds is a far worse outcome than
   * a customer pressing "Pay now" once more.
   */
  if (input.paymentMethod === "ONLINE" && orderId && isRazorpayConfigured()) {
    const result = await createRazorpayOrder({
      amountPaise: priced.total,
      receipt: orderNumber,
      notes: { orderNumber },
    });
    if (result.ok) {
      /**
       * This one write is what maps their order back to ours, and its failure
       * used to be discarded with an empty `.catch(() => {})`.
       *
       * A pool timeout or a cold connection here left a Razorpay order that is
       * live and payable with nothing on our side pointing at it. The customer
       * could pay in full and the webhook — which looked up orders only by
       * `razorpayOrderId` — would find nothing and log `unknown-order`.
       *
       * Two things changed. The failure is logged loudly with both ids, so it
       * is findable rather than invisible. And the webhook now falls back to
       * the order number that Razorpay echoes back in `notes` and `receipt`,
       * so the payment is still attributed and this column is backfilled on
       * the way through. §29.
       *
       * Still not fatal to the checkout. The order exists and is correct; the
       * customer can pay from the order page, which creates or reuses the
       * Razorpay order and writes this column then.
       */
      try {
        await prisma.order.update({
          where: { id: orderId },
          data: { razorpayOrderId: result.value.id },
        });
      } catch (error) {
        console.error(
          `[razorpay] FAILED to link order ${orderNumber} (id ${orderId}) to razorpay order ${result.value.id} — payment for it will be recovered via notes/receipt:`,
          error,
        );
      }
    } else {
      console.error(`[razorpay] could not create order for ${orderNumber}: ${result.error}`);
    }
  }

  if (customer) revalidatePath("/account");

  /**
   * Guests get a signed link; a signed-in customer does not need one, because
   * the page authorises them by session. Handing a signed token to someone who
   * is already authorised would put a shareable credential in their URL bar
   * for no reason.
   */
  /**
   * `placed=1` is what tells the order page this is an arrival from checkout,
   * so it clears the browser's bag. Without it, opening the same URL from a
   * confirmation email weeks later would empty whatever is in the bag then.
   */
  redirect(
    customer
      ? `/orders/${orderNumber}?placed=1`
      : `${guestOrderPath(orderNumber)}&placed=1`,
  );
}
