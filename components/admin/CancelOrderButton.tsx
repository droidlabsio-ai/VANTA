"use client";

import { useActionState, useState } from "react";
import { cancelOrderAction, type CancelState } from "@/app/admin/(dashboard)/orders/actions";
import { Button } from "@/components/admin/ui";

/**
 * Cancel, in two presses, with an optional reason (§49). Same shape as
 * `RefundButton`: the first press only asks, the second one acts.
 */
export function CancelOrderButton({ orderId, courierBooked }: { orderId: string; courierBooked: boolean }) {
  const [asking, setAsking] = useState(false);
  const [state, formAction, pending] = useActionState<CancelState, FormData>(cancelOrderAction, {
    ok: false,
    message: null,
  });

  if (state.ok) return <span className="text-xs font-semibold text-admin-ink">{state.message}</span>;

  return (
    <div className="space-y-2">
      {!asking ? (
        <Button type="button" variant="danger" onClick={() => setAsking(true)}>
          Cancel order
        </Button>
      ) : (
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="orderId" value={orderId} />
          <label className="block text-xs text-admin-muted">
            Reason (optional, for your records)
            <input
              name="reason"
              maxLength={200}
              placeholder="e.g. customer asked to cancel"
              className="mt-1 w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-ink focus:border-admin-accent focus:outline-none"
            />
          </label>
          <p className="text-xs text-admin-ink">
            Cancel this order? Its stock goes back.
            {courierBooked ? " It is already booked with the courier — cancel it in Shiprocket too." : ""}
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Cancelling…" : "Yes, cancel"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setAsking(false)}>
              Keep order
            </Button>
          </div>
        </form>
      )}
      {state.message && <p className="text-xs text-admin-danger">{state.message}</p>}
    </div>
  );
}
