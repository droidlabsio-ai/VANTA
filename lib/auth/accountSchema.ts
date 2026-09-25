import { z } from "zod";

/**
 * What a customer is allowed to submit.
 *
 * Client-safe on purpose: no `server-only`, no database import. The register
 * and sign-in forms use the same shapes the actions validate against, so the
 * rules are written once and the browser can enforce them before a round trip
 * — while the server still enforces them again, because a form is a
 * suggestion.
 */

/**
 * Lowercased and trimmed at the edge, so `Bunny@Gmail.com` and
 * `bunny@gmail.com` are one account rather than two.
 */
/**
 * Long enough to be worth hashing, short enough not to be a denial of service.
 *
 * Declared here rather than beside the hashing, because the register form needs
 * the number too — and `lib/auth/password.ts` is `server-only`, so a client
 * component importing anything from it is a build error.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email("That doesn’t look like an email address.")
      .max(254, "That email address is too long."),
  );

export const passwordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, "That password is too long.");

/**
 * Indian mobile numbers, with or without +91 and with spaces or dashes left in.
 * Normalised to ten digits so a courier API is never handed "+91 98765 43210".
 */
export const phoneField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-()]/g, "").replace(/^(\+91|0)/, ""))
  .pipe(
    z
      .string()
      .regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number."),
  );

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80, "That name is too long."),
  email: emailField,
  password: passwordField,
});

export const signInSchema = z.object({
  email: emailField,
  // Deliberately not `passwordField`. Sign-in must not tell an attacker that a
  // password was rejected for being too short — that is a fact about the
  // password policy leaking into a place it does not belong. Anything that
  // fails here fails as "email or password isn't right".
  password: z.string().min(1, "Enter your password."),
});

export const addressSchema = z.object({
  fullName: z.string().trim().min(1, "Enter a name for the delivery.").max(80),
  phone: phoneField,
  line1: z.string().trim().min(1, "Enter the flat, building and street.").max(160),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(1, "Enter the city.").max(80),
  state: z.string().trim().min(1, "Enter the state.").max(80),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit pincode."),
  isDefault: z.boolean().optional(),
});

/**
 * Turns a Zod failure into `{ field: message }` for a form.
 *
 * Only the first message per field survives. A field with three complaints
 * stacked under it reads as a broken form, not a helpful one.
 */
/** "Forgot password": just the email. §44. */
export const forgotPasswordSchema = z.object({
  email: emailField,
});

/**
 * Choosing a new password from a reset link. The same rules as registration,
 * plus a confirmation — there is no "old password" to type, so a typo here
 * would lock the customer straight back out.
 */
export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "The two passwords don’t match.",
    path: ["confirm"],
  });

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

/**
 * The shape every account form's `useActionState` carries.
 *
 * It lives here rather than beside the actions because a `"use server"` module
 * may only export async functions — a constant or an interface exported from
 * one is a build error. Both halves of the form contract belong in a file that
 * either side can import.
 */
export interface AccountFormState {
  /** Keyed by field name; `form` holds anything that isn't about one field. */
  errors: Record<string, string>;
  /** Set on success, for the forms that stay on the page afterwards. */
  message?: string;
}

export const emptyFormState: AccountFormState = { errors: {} };
