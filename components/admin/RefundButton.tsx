"use client";

import { useActionState, useState } from "react";
import { refundOrderAction, type RefundState } from "@/app/admin/(dashboard)/orders/actions";
import { Button } from "@/components/admin/ui";

/**
 * Refund, in two presses (§48).
 *
 * Money leaving the business deserves a second look, so the first press only
 * asks — with the amount spelled out — and the second one sends. Inline rather
 * than a browser `confirm()`, which some admin browsers block and which can't
 * say anything useful about what happens to stock.
 */
export function RefundButton({
  orderId,
  amountLabel,
  restocks,
}: {
  orderId: string;
  amountLabel: string;
  restocks: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [state, formAction, pending] = useActionState<RefundState, FormData>(refundOrderAction, {
    ok: false,
    message: null,
  });

  if (state.ok) {
    // The row re-renders as refunded on the next navigation; say so now.
    return <span className="text-xs font-semibold text-admin-ink">{state.message}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!asking ? (
        <Button
          type="button"
          variant="danger"
          className="px-3 py-1 text-xs"
          onClick={() => setAsking(true)}
        >
          Refund
        </Button>
      ) : (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <span className="text-xs text-admin-ink">
            Refund {amountLabel} in full?{restocks ? " Stock goes back." : ""}
          </span>
          <Button type="submit" variant="danger" className="px-3 py-1 text-xs" disabled={pending}>
            {pending ? "Refunding…" : "Yes, refund"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1 text-xs"
            disabled={pending}
            onClick={() => setAsking(false)}
          >
            Cancel
          </Button>
        </form>
      )}
      {state.message && <span className="text-xs text-admin-danger">{state.message}</span>}
    </div>
  );
}
