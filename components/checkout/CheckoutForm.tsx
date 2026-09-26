"use client";

import { useActionState, useState } from "react";
import { useBag } from "@/components/BagProvider";
import { createOrder } from "@/app/checkout/actions";
import { emptyCheckoutState, type CheckoutFormState } from "@/lib/checkoutSchema";
import { Field, FormError, SubmitButton, TextInput } from "@/components/account/AccountFormParts";
import { TurnstileWidget } from "@/components/TurnstileWidget";

export interface SavedAddress {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

/**
 * The checkout form.
 *
 * A client leaf because it needs the bag, which lives in `localStorage` and is
 * therefore unknowable to the server. The page around it — the summary, the
 * saved addresses, the totals — is all server-rendered.
 *
 * The bag is submitted as ids and quantities in a hidden field, and nothing
 * else. No prices, no totals. The server prices it from the catalogue, twice:
 * once to render the summary and again inside the action. Sending a total the
 * server then "verifies" would mean the checkout had two sources of truth for
 * what something costs, and the customer controlled one of them.
 */
export function CheckoutForm({
  addresses,
  signedInEmail,
  onlinePaymentEnabled,
}: {
  addresses: SavedAddress[];
  signedInEmail: string | null;
  /** Whether Razorpay keys are configured. Decided on the server; the browser
   *  has no way to know, and must not be told anything more than yes or no. */
  onlinePaymentEnabled: boolean;
}) {
  const { lines } = useBag();
  const [state, formAction] = useActionState(createOrder, emptyCheckoutState);

  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];
  const [selected, setSelected] = useState<string>(defaultAddress?.id ?? "new");
  const usingSaved = selected !== "new";

  /**
   * A failed submit leaves the form mounted with the same values, so an error
   * about the address must clear when a different one is chosen — otherwise it
   * sits there contradicting what is on screen.
   *
   * Tracks *which* state was dismissed rather than a boolean reset by an
   * effect. A new state object from the action is by definition not the one
   * that was dismissed, so a fresh error shows without anything having to
   * notice the change and clear a flag.
   */
  const [dismissedFor, setDismissedFor] = useState<CheckoutFormState | null>(null);
  const formError = dismissedFor === state ? undefined : state.errors.form;

  return (
    <form action={formAction} className="space-y-8">
      {/* Ids, sizes and quantities only — see the note above. */}
      <input
        type="hidden"
        name="lines"
        value={JSON.stringify(
          lines.map((l) => ({ productId: l.id, ...(l.sku ? { sku: l.sku } : {}), quantity: l.qty })),
        )}
      />

      <section className="space-y-4">
        <h2 className="text-label font-bold uppercase tracking-[0.12em] text-bone/50">Contact</h2>
        <Field label="Email" htmlFor="email" error={state.errors.email} hint="Used to contact you about this order.">
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={signedInEmail ?? ""}
            invalid={Boolean(state.errors.email)}
          />
        </Field>
      </section>

      <section className="space-y-4">
        <h2 className="text-label font-bold uppercase tracking-[0.12em] text-bone/50">Delivery</h2>

        {addresses.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="sr-only">Choose a delivery address</legend>
            {addresses.map((address) => (
              <label
                key={address.id}
                className="flex cursor-pointer gap-3 border border-ink-line px-4 py-3 transition-colors hover:border-bone/30"
              >
                <input
                  type="radio"
                  name="savedAddressId"
                  value={address.id}
                  checked={selected === address.id}
                  onChange={() => {
                    setSelected(address.id);
                    setDismissedFor(state);
                  }}
                  className="mt-1 accent-bone"
                />
                <span className="text-sm leading-relaxed text-bone/70">
                  <span className="block text-bone">{address.fullName}</span>
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state}{" "}
                  {address.pincode}
                  <span className="block text-bone/40">{address.phone}</span>
                </span>
              </label>
            ))}

            <label className="flex cursor-pointer gap-3 border border-ink-line px-4 py-3 transition-colors hover:border-bone/30">
              <input
                type="radio"
                name="savedAddressId"
                value=""
                checked={selected === "new"}
                onChange={() => {
                  setSelected("new");
                  setDismissedFor(state);
                }}
                className="mt-1 accent-bone"
              />
              <span className="text-sm text-bone/70">Deliver somewhere else</span>
            </label>
          </fieldset>
        )}

        {/*
          Rendered but hidden rather than unmounted when a saved address is
          chosen. Unmounting would discard anything already typed the moment
          someone clicked a saved address to compare, and they would have to
          type it again to go back.
        */}
        <div className={usingSaved ? "hidden" : "space-y-4"} aria-hidden={usingSaved}>
          <Field label="Full name" htmlFor="fullName" error={state.errors.fullName}>
            <TextInput
              id="fullName"
              name="fullName"
              autoComplete="name"
              disabled={usingSaved}
              invalid={Boolean(state.errors.fullName)}
            />
          </Field>

          <Field label="Phone" htmlFor="phone" error={state.errors.phone} hint="10-digit Indian mobile number.">
            <TextInput
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              disabled={usingSaved}
              invalid={Boolean(state.errors.phone)}
            />
          </Field>

          <Field label="Flat, building and street" htmlFor="line1" error={state.errors.line1}>
            <TextInput
              id="line1"
              name="line1"
              autoComplete="address-line1"
              disabled={usingSaved}
              invalid={Boolean(state.errors.line1)}
            />
          </Field>

          <Field label="Area, landmark" htmlFor="line2" error={state.errors.line2} hint="Optional.">
            <TextInput id="line2" name="line2" autoComplete="address-line2" disabled={usingSaved} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" htmlFor="city" error={state.errors.city}>
              <TextInput
                id="city"
                name="city"
                autoComplete="address-level2"
                disabled={usingSaved}
                invalid={Boolean(state.errors.city)}
              />
            </Field>
            <Field label="State" htmlFor="state" error={state.errors.state}>
              <TextInput
                id="state"
                name="state"
                autoComplete="address-level1"
                disabled={usingSaved}
                invalid={Boolean(state.errors.state)}
              />
            </Field>
            <Field label="Pincode" htmlFor="pincode" error={state.errors.pincode}>
              <TextInput
                id="pincode"
                name="pincode"
                inputMode="numeric"
                autoComplete="postal-code"
                disabled={usingSaved}
                invalid={Boolean(state.errors.pincode)}
              />
            </Field>
          </div>

          {signedInEmail && (
            <label className="flex items-center gap-2 text-sm text-bone/60">
              <input type="checkbox" name="saveAddress" defaultChecked className="accent-bone" />
              Save this address to my account
            </label>
          )}
        </div>

        {state.errors.address && (
          <p className="text-xs text-flare-orange">{state.errors.address}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-label font-bold uppercase tracking-[0.12em] text-bone/50">Payment</h2>

        <label className="flex cursor-pointer items-start gap-3 border border-ink-line px-4 py-3">
          <input type="radio" name="paymentMethod" value="COD" defaultChecked className="mt-1 accent-bone" />
          <span className="text-sm text-bone/70">
            <span className="block text-bone">Cash on delivery</span>
            Pay when it arrives.
          </span>
        </label>

        {/*
          Offered either way, and honest either way. When Razorpay isn't
          configured the option still records the order as awaiting payment and
          says so, rather than a "Pay now" button that leads nowhere — which is
          worst at the exact moment someone has decided to buy.

          The order is placed first and paid second in both cases. Payment
          happens on the order page, not here, so an abandoned payment leaves a
          real order we can follow up rather than nothing at all.
        */}
        <label className="flex cursor-pointer items-start gap-3 border border-ink-line px-4 py-3">
          <input type="radio" name="paymentMethod" value="ONLINE" className="mt-1 accent-bone" />
          <span className="text-sm text-bone/70">
            <span className="block text-bone">Pay online</span>
            {onlinePaymentEnabled
              ? "Card, UPI, netbanking or wallet. You’ll pay on the next screen."
              : "Card and UPI aren’t connected yet. Your order is saved and held until payment is set up — nothing is charged."}
          </span>
        </label>
      </section>

      <section>
        <Field label="Order notes" htmlFor="note" error={state.errors.note} hint="Optional. Delivery instructions, a landmark.">
          <TextInput id="note" name="note" />
        </Field>
      </section>

      <FormError message={formError} />

      {/* Reset after every server answer: the token a submit carried is spent
          whether the order went through or not (§43). */}
      <TurnstileWidget action="checkout" resetKey={state} />

      <SubmitButton pendingLabel="Placing order…">Place order</SubmitButton>
    </form>
  );
}
