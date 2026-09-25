"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasDatabase, prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  fieldErrors,
  forgotPasswordSchema,
  resetPasswordSchema,
  type AccountFormState,
} from "@/lib/auth/accountSchema";
import { createCustomerSession } from "@/lib/auth/customerSession";
import {
  consumeResetToken,
  issueResetToken,
  resetEmail,
  resetLink,
  RESET_TOKEN_TTL_MS,
} from "@/lib/auth/passwordReset";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { checkAll, rateLimitKey, recordFailureAll } from "@/lib/rateLimit";
import { TURNSTILE_FIELD, verifyTurnstileIfConfigured } from "@/lib/turnstile";

/**
 * Forgot password. §44.
 *
 * Two actions: ask for a link, and use one. Kept out of `actions.ts` because
 * that file is already the whole of sign-in, registration, sync and the
 * address book.
 */

const NO_DATABASE_ERROR = "Accounts aren’t available right now. Please try again shortly.";
const FAIL_MODE = "open" as const;
const SCOPE = "reset";

async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() ?? headerList.get("x-real-ip") ?? "unknown";
}

/**
 * Sends a reset link, if the email belongs to an account.
 *
 * **The answer is the same whether or not it does.** "No account with that
 * email" would let anyone test addresses against the customer list. The work
 * that differs — writing a token, calling Resend — runs in `after()`, once the
 * response has gone, so the reply takes the same time either way and its
 * timing does not give the answer away either.
 *
 * Limited like the other customer forms: IP and email, five requests per
 * fifteen minutes, each request counted. Beyond protecting the inbox of
 * whoever's address is being typed in, every request is a paid-for email once
 * the account is on a paid plan. Turnstile when configured, as elsewhere.
 */
export async function requestPasswordResetAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  if (!hasDatabase()) return { errors: { form: NO_DATABASE_ERROR } };

  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { email } = parsed.data;

  const ip = await clientIp();
  const keys = [rateLimitKey.ip(SCOPE, ip), rateLimitKey.identifier(SCOPE, email)];
  const limit = await checkAll(keys, FAIL_MODE);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    return {
      errors: {
        form: `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      },
    };
  }

  const captcha = await verifyTurnstileIfConfigured(
    String(formData.get(TURNSTILE_FIELD) ?? ""),
    ip === "unknown" ? null : ip,
  );
  await recordFailureAll(keys, FAIL_MODE);
  if (!captcha.ok) {
    return { errors: { form: "Couldn’t verify that you’re human. Please try again." } };
  }

  // Said plainly rather than pretending a link is on its way. It reveals
  // nothing about any account: it is the same for every address.
  if (!isEmailConfigured()) {
    return {
      errors: {
        form: "Password reset by email isn’t set up yet. Please contact us and we’ll help you get back in.",
      },
    };
  }

  const requestIp = ip === "unknown" ? null : ip;
  after(async () => {
    try {
      const customer = await prisma.customer.findUnique({
        where: { email },
        select: { id: true, name: true },
      });
      if (!customer) return;
      const token = await issueResetToken(customer.id, requestIp);
      const message = resetEmail(customer.name, resetLink(token));
      await sendEmail({ to: email, ...message });
    } catch (error) {
      // After the response: nobody is waiting, so the log is the only witness.
      console.error("[password-reset] could not issue or send a reset link:", error);
    }
  });

  const minutes = RESET_TOKEN_TTL_MS / 60_000;
  return {
    errors: {},
    message: `If there’s an account for ${email}, we’ve emailed it a link to reset the password. The link expires in ${minutes} minutes — check your spam folder if it hasn’t arrived.`,
  };
}

/**
 * Sets a new password from a reset link, then signs this browser in.
 *
 * `consumeResetToken` does the dangerous part in one transaction: claims the
 * token, changes the password, and deletes every existing session. A new
 * session is then created here, so the person who just proved they own the
 * inbox is not bounced to a login form to type the password they just chose.
 *
 * No rate limit: the token is 256 random bits, so there is nothing to guess,
 * and a wrong or spent one costs one indexed lookup.
 */
export async function resetPasswordAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  if (!hasDatabase()) return { errors: { form: NO_DATABASE_ERROR } };

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const token = String(formData.get("token") ?? "");
  const customerId = await consumeResetToken(token, await hashPassword(parsed.data.password));

  if (!customerId) {
    return {
      errors: {
        form: "This reset link has expired or has already been used. Ask for a new one below.",
      },
    };
  }

  await createCustomerSession(customerId);
  redirect("/account");
}
