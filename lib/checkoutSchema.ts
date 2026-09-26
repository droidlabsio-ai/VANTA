import { z } from "zod";
import { addressSchema, emailField } from "@/lib/auth/accountSchema";

/**
 * What a checkout submission is allowed to contain.
 *
 * Client-safe, like `lib/auth/accountSchema.ts`: no `server-only`, no database
 * import, so the form and the action validate against the same shapes.
 *
 * Note what is **absent**. There is no price here, no line total, no order
 * total. The browser sends product ids and quantities and nothing else, and
 * the server prices them from the live catalogue. Accepting a price from a
 * form — even one the server later "checks" — means the checkout has two
 * sources of truth for what something costs, and the wrong one is under the
 * customer's control.
 */

/** Matches `MAX_QTY` in `components/BagProvider.tsx` and `customerData.ts`. */
const MAX_QTY = 99;

/** Matches `MAX_LINES` in `lib/auth/customerData.ts`. */
const MAX_LINES = 200;

export const checkoutLineSchema = z.object({
  productId: z.string().trim().min(1).max(128),
  /** The size's SKU (§47). Optional: a bag from before §47 has none. */
  sku: z.string().trim().max(64).optional(),
  quantity: z.number().int().min(1).max(MAX_QTY),
});

export const paymentMethodSchema = z.enum(["COD", "ONLINE"]);

/**
 * The address, either chosen from the book or typed in.
 *
 * `savedAddressId` is a *hint*, never authorisation. The action looks the row
 * up scoped to the signed-in customer, so an id belonging to someone else
 * resolves to nothing rather than to their address.
 */
export const checkoutSchema = z
  .object({
    email: emailField,
    lines: z.array(checkoutLineSchema).min(1, "Your bag is empty.").max(MAX_LINES),
    paymentMethod: paymentMethodSchema,
    savedAddressId: z.string().trim().max(64).optional(),
    address: addressSchema.optional(),
    note: z.string().trim().max(500).optional(),
    /** Ticked by a signed-in customer to keep a newly typed address. */
    saveAddress: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.savedAddressId) || Boolean(value.address), {
    message: "Choose a delivery address.",
    path: ["address"],
  });

/** The shape every checkout form's `useActionState` carries. */
export interface CheckoutFormState {
  errors: Record<string, string>;
  /** Set when the order was placed, so the client can clear the bag. */
  orderNumber?: string;
}

export const emptyCheckoutState: CheckoutFormState = { errors: {} };
