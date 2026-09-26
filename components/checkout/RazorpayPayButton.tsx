"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startPayment } from "@/app/orders/[orderNumber]/actions";
import { formatPaise } from "@/lib/money";

/**
 * The "Pay now" button on an unpaid online order.
 *
 * It opens Razorpay's hosted checkout and then — importantly — does almost
 * nothing with the result. Their handler fires in the customer's browser, and
 * a browser cannot be trusted to tell us a payment happened: the request is
 * one the customer's own machine makes, so the customer can make it too. What
 * this does on success is refresh the page, which re-reads the order from the
 * database, where the webhook will have recorded the payment.
 *
 * That is also why the success path shows "confirming" rather than "paid".
 * The webhook usually lands within a second or two, but it is a separate
 * delivery over a separate connection; claiming the order is paid before we
 * have actually recorded it would mean the page can say "paid" about an order
 * that our own database still calls PENDING_PAYMENT.
 *
 * Nothing here matters for correctness. Close the tab mid-payment and the
 * webhook still confirms the order — this component only shortens the wait.
 */

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name?: string; email?: string; contact?: string };
  theme: { color: string };
  handler: () => void;
  modal: { ondismiss: () => void };
  /** Seconds before Razorpay closes the window by itself. */
  timeout?: number;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** Loaded on demand, once. Injecting it twice registers two globals. */
function loadCheckout(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
    script.addEventListener("error", () => resolve(false), { once: true });
    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.body.append(script);
    }
  });
}

type Phase = "idle" | "working" | "confirming" | "error";

export function RazorpayPayButton({
  orderNumber,
  token,
  amount,
}: {
  orderNumber: string;
  token?: string;
  amount: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  /**
   * While confirming, poll the server for the webhook's verdict.
   *
   * A refresh alone can race the webhook — the customer's browser is often
   * faster than the delivery. Re-checking a few times turns "it says awaiting
   * payment even though I paid" into a second of waiting.
   */
  useEffect(() => {
    if (phase !== "confirming") return;
    let cancelled = false;
    let tries = 0;
    const timer = setInterval(() => {
      if (cancelled || ++tries > 10) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, router]);

  const pay = useCallback(async () => {
    setPhase("working");
    setMessage(null);

    const [handoff, scriptReady] = await Promise.all([
      startPayment(orderNumber, token),
      loadCheckout(),
    ]);

    if (!handoff.ok || !handoff.razorpayOrderId || !handoff.keyId) {
      setPhase("error");
      setMessage(handoff.error ?? "Couldn’t start the payment.");
      return;
    }
    if (!scriptReady || !window.Razorpay) {
      setPhase("error");
      setMessage("Couldn’t load the payment window. Check your connection and try again.");
      return;
    }

    new window.Razorpay({
      key: handoff.keyId,
      amount: handoff.amount ?? amount,
      currency: "INR",
      name: "VANTA",
      description: `Order ${handoff.orderNumber ?? orderNumber}`,
      order_id: handoff.razorpayOrderId,
      prefill: {
        name: handoff.name,
        email: handoff.email,
        contact: handoff.phone,
      },
      theme: { color: "#0b0b0b" },
      // No payment id is read from here, deliberately. See the note above.
      handler: () => setPhase("confirming"),
      timeout: handoff.timeout,
      modal: { ondismiss: () => setPhase("idle") },
    }).open();
  }, [amount, orderNumber, token]);

  if (phase === "confirming") {
    return (
      <div className="mt-6 border border-ink-line bg-ink-soft px-4 py-4">
        <p className="text-sm text-bone">Confirming your payment…</p>
        <p className="mt-2 text-sm leading-relaxed text-bone/60">
          This page updates itself. You can close it — your payment is recorded
          whether or not this tab stays open.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={pay}
        disabled={phase === "working"}
        className="border border-bone bg-bone px-6 py-3 text-label font-bold uppercase tracking-[0.12em] text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {phase === "working" ? "Opening…" : `Pay ${formatPaise(amount)}`}
      </button>
      {message && <p className="mt-3 text-xs text-flare-orange">{message}</p>}
    </div>
  );
}
