"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hasDatabase, prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  addressSchema,
  fieldErrors,
  registerSchema,
  signInSchema,
  type AccountFormState,
} from "@/lib/auth/accountSchema";
import {
  createCustomerSession,
  destroyCustomerSession,
  getCustomer,
  requireCustomer,
} from "@/lib/auth/customerSession";
import {
  mergeCustomerData,
  saveCustomerData,
  type CustomerData,
} from "@/lib/auth/customerData";
import {
  checkAll,
  clearAttemptsAll,
  rateLimitKey,
  recordFailureAll,
} from "@/lib/rateLimit";
import { TURNSTILE_FIELD, verifyTurnstileIfConfigured } from "@/lib/turnstile";
import { safeNextPath } from "@/lib/safeRedirect";

/**
 * Everything a customer can do to their own account.
 *
 * Every function here re-establishes who is asking with `requireCustomer()`
 * rather than trusting an id from the form. A server action is a public HTTP
 * endpoint with a hard-to-guess name — it is not private just because the only
 * button that calls it is behind a sign-in.
 */

/**
 * One message for every credential failure, whatever went wrong.
 *
 * It never says which of the two was wrong and never distinguishes "no such
 * account" from "wrong password" — either would turn this form into a way of
 * asking whether an email address has an account here.
 */
const GENERIC_SIGN_IN_ERROR = "That email or password isn’t right. Please try again.";

const NO_DATABASE_ERROR =
  "Accounts aren’t available right now. Please try again shortly.";

/**
 * Prisma's "unique constraint failed".
 *
 * Duck-typed rather than an `instanceof` against the generated error class:
 * the class is re-exported from generated code that moves between Prisma
 * versions, and the code itself — P2002 — is the stable part of the contract.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() ?? headerList.get("x-real-ip") ?? "unknown";
}

/**
 * Two buckets per attempt: the address it came from, and the account it is
 * aimed at. IP alone lets a botnet spread guesses thinly enough to never trip
 * the limit; email alone lets anyone lock a real customer out of their own
 * account from anywhere.
 */
async function limitKeys(scope: string, identifier: string): Promise<string[]> {
  const ip = await clientIp();
  return [rateLimitKey.ip(scope, ip), rateLimitKey.identifier(scope, identifier)];
}

/**
 * Customer forms fail **OPEN** where the admin login fails closed.
 *
 * A shopper locked out by a database blip is a lost sale and a support message,
 * and what is being protected — one account, behind a scrypt hash — is worth
 * less than the storefront staying usable. The admin login makes the opposite
 * call, and both are written down in `lib/rateLimit.ts`.
 */
const FAIL_MODE = "open" as const;

/**
 * Captcha for the customer forms.
 *
 * Skipped when Turnstile is unconfigured, so development works without a
 * Cloudflare account. That is the opposite of the admin login, deliberately:
 * the cost of a missing captcha here is spam registrations, and the cost of
 * refusing outright is a storefront nobody can sign up to.
 */
async function captchaOk(formData: FormData): Promise<boolean> {
  const ip = await clientIp();
  const result = await verifyTurnstileIfConfigured(
    String(formData.get(TURNSTILE_FIELD) ?? ""),
    ip === "unknown" ? null : ip,
  );
  return result.ok;
}

function tooManyAttempts(retryAfterSeconds: number): AccountFormState {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return {
    errors: {
      form: `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Sign up                                                                    */
/* -------------------------------------------------------------------------- */

export async function registerAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  if (!hasDatabase()) return { errors: { form: NO_DATABASE_ERROR } };

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  // Rate limited on signup as well as sign-in. Without it this endpoint is a
  // free way to hash arbitrary strings on someone else's server, and scrypt is
  // expensive by design.
  const keys = await limitKeys("register", parsed.data.email);
  const limit = await checkAll(keys, FAIL_MODE);
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds);

  if (!(await captchaOk(formData))) {
    // Counted, so posting straight to the action without ever loading the
    // widget is not an unlimited free run at creating accounts.
    await recordFailureAll(keys, FAIL_MODE);
    return { errors: { form: "Couldn’t verify that you’re human. Please try again." } };
  }

  const { name, email, password } = parsed.data;

  try {
    const customer = await prisma.customer.create({
      data: { name, email, passwordHash: await hashPassword(password) },
      select: { id: true },
    });
    await clearAttemptsAll(keys);
    await createCustomerSession(customer.id);
  } catch (error) {
    await recordFailureAll(keys, FAIL_MODE);
    // P2002 is the unique index on `email` doing its job. Checking first and
    // then inserting would be a race: two submissions of the same form a
    // millisecond apart would both find nothing and both try to insert.
    if (isUniqueViolation(error)) {
      return {
        errors: {
          email: "An account with this email already exists. Sign in instead.",
        },
      };
    }
    throw error;
  }

  // Outside the try: `redirect` works by throwing, and catching it here would
  // turn a successful signup into an unhandled error. Honours `next` like
  // sign-in does — the form always carried it, and the action ignored it, so
  // someone who registered from checkout landed on /account instead (§43).
  redirect(safeNextPath(formData.get("next")));
}

/* -------------------------------------------------------------------------- */
/* Sign in and out                                                            */
/* -------------------------------------------------------------------------- */

export async function signInAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  if (!hasDatabase()) return { errors: { form: NO_DATABASE_ERROR } };

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const keys = await limitKeys("signin", parsed.data.email);
  const limit = await checkAll(keys, FAIL_MODE);
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds);

  if (!(await captchaOk(formData))) {
    await recordFailureAll(keys, FAIL_MODE);
    return { errors: { form: "Couldn’t verify that you’re human. Please try again." } };
  }

  const customer = await prisma.customer.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, passwordHash: true },
  });

  // A missing account still costs a hash. Returning early would make "no such
  // email" measurably faster than "wrong password", which is the same
  // disclosure the shared error message exists to prevent.
  const passwordOk = await verifyPassword(
    parsed.data.password,
    customer?.passwordHash ??
      "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==",
  );

  if (!customer || !passwordOk) {
    const after = await recordFailureAll(keys, FAIL_MODE);
    if (!after.allowed) return tooManyAttempts(after.retryAfterSeconds);
    return { errors: { form: GENERIC_SIGN_IN_ERROR } };
  }

  await clearAttemptsAll(keys);
  await createCustomerSession(customer.id);

  // Only same-site paths. Reflecting an arbitrary URL back into a redirect is
  // an open redirect, and a sign-in page is exactly where one is useful. The
  // check lives in `lib/safeRedirect.ts` — the inline version here let
  // `/\evil.com` through (§43).
  redirect(safeNextPath(formData.get("next")));
}

export async function signOutAction(): Promise<void> {
  await destroyCustomerSession();
  redirect("/");
}

/* -------------------------------------------------------------------------- */
/* Bag and wishlist                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Called once per page load by `components/AccountSync.tsx`, with whatever the
 * browser currently holds. Returns the merged list for the client to adopt.
 *
 * Returns null when nobody is signed in, which is not an error — it is the
 * answer that tells the client to leave localStorage alone and stop asking.
 */
export async function syncAccountDataAction(
  incoming: Partial<CustomerData>,
): Promise<CustomerData | null> {
  const customer = await getCustomer();
  if (!customer) return null;
  return mergeCustomerData(customer.id, incoming);
}

/** Called after every change to the bag or wishlist, debounced by the client. */
export async function saveAccountDataAction(
  incoming: Partial<CustomerData>,
): Promise<CustomerData | null> {
  const customer = await getCustomer();
  if (!customer) return null;
  return saveCustomerData(customer.id, incoming);
}

/* -------------------------------------------------------------------------- */
/* Address book                                                               */
/* -------------------------------------------------------------------------- */

export async function saveAddressAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const customer = await requireCustomer();

  const parsed = addressSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    line1: formData.get("line1"),
    line2: formData.get("line2") || undefined,
    city: formData.get("city"),
    state: formData.get("state"),
    pincode: formData.get("pincode"),
    isDefault: formData.get("isDefault") === "on",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { isDefault, ...fields } = parsed.data;
  // The id comes from the form, so it is checked against the signed-in
  // customer below rather than trusted. An `updateMany` scoped by `customerId`
  // makes editing someone else's address a no-op instead of a vulnerability.
  const id = String(formData.get("id") ?? "");

  const count = await prisma.address.count({ where: { customerId: customer.id } });
  // The first address is the default whether or not the box was ticked —
  // otherwise a customer with exactly one address has no default at all.
  const makeDefault = isDefault || count === 0;

  await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.address.updateMany({
        where: { customerId: customer.id },
        data: { isDefault: false },
      });
    }

    if (id) {
      await tx.address.updateMany({
        where: { id, customerId: customer.id },
        data: { ...fields, isDefault: makeDefault },
      });
    } else {
      await tx.address.create({
        data: { ...fields, isDefault: makeDefault, customerId: customer.id },
      });
    }
  });

  revalidatePath("/account");
  return { errors: {}, message: id ? "Address updated." : "Address saved." };
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const customer = await requireCustomer();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const deleted = await prisma.address.deleteMany({
    where: { id, customerId: customer.id },
  });

  // Deleting the default leaves the account without one. Promote the oldest
  // survivor rather than leaving checkout with nothing preselected — but only
  // when no default survives. The earlier version promoted the oldest address
  // whenever *it* was not the default, so deleting any non-default address
  // while a newer one was the default left the account with two (§43).
  if (deleted.count > 0) {
    const hasDefault = await prisma.address.count({
      where: { customerId: customer.id, isDefault: true },
    });
    if (hasDefault === 0) {
      const oldest = await prisma.address.findFirst({
        where: { customerId: customer.id },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (oldest) {
        await prisma.address.update({
          where: { id: oldest.id },
          data: { isDefault: true },
        });
      }
    }
  }

  revalidatePath("/account");
}
