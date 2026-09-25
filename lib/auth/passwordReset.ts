import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { escapeHtml } from "@/lib/email";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Password reset tokens. §44.
 *
 * The same shape as customer sessions (§24): 32 random bytes go in the link,
 * and only their SHA-256 digest is stored. A token is:
 *
 * - **short-lived** — thirty minutes. Long enough to find the email and open
 *   it; short enough that a link sitting in an inbox for a week is dead.
 * - **single-use** — `usedAt` is set in the same transaction that changes the
 *   password, and a token with `usedAt` is never accepted again.
 * - **the only one outstanding** — asking again deletes the customer's older
 *   tokens, so "the link from the first email" stops working the moment a
 *   second is sent. That is what someone who asks twice expects.
 *
 * Plain SHA-256 rather than a slow hash, for the same reason as sessions: the
 * input is 256 bits of randomness, not a password, so there is nothing to
 * brute-force and a fast digest is the right tool.
 */

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_BYTES = 32;

/** The shape a token in a link must have, checked before any database work. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const digest = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

export function looksLikeResetToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/**
 * Issues a fresh token for a customer, replacing any older ones. Returns the
 * raw token — the only time it exists outside the email.
 */
export async function issueResetToken(customerId: string, ip: string | null): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { customerId } }),
    prisma.passwordResetToken.create({
      data: {
        customerId,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        ip,
      },
    }),
  ]);
  return token;
}

/** The customer a still-valid token belongs to, or null. Does not consume it. */
export async function findValidResetToken(
  token: unknown,
): Promise<{ id: string; customerId: string; email: string } | null> {
  if (!looksLikeResetToken(token)) return null;
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: digest(token) },
    select: {
      id: true,
      customerId: true,
      usedAt: true,
      expiresAt: true,
      customer: { select: { email: true } },
    },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  return { id: row.id, customerId: row.customerId, email: row.customer.email };
}

/**
 * Sets the new password and spends the token, atomically.
 *
 * The token is claimed with a conditional update — `usedAt` still null and not
 * expired — so two submits of the same link race to one winner rather than
 * both changing the password. Every session the customer has is then deleted:
 * whoever knew the old password, or held a stolen session cookie, is signed out
 * everywhere. That is the main reason a reset exists, and it gives
 * `destroyAllCustomerSessions`' intent its first caller (inlined here so it is
 * inside the transaction). The caller signs this browser back in afterwards.
 *
 * Returns the customer id on success, null when the token was not (or no
 * longer) valid.
 */
export async function consumeResetToken(
  token: string,
  newPasswordHash: string,
): Promise<string | null> {
  if (!looksLikeResetToken(token)) return null;
  const tokenHash = digest(token);

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count === 0) return null;

    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { customerId: true },
    });
    if (!row) return null;

    await tx.customer.update({
      where: { id: row.customerId },
      data: { passwordHash: newPasswordHash },
    });
    await tx.customerSession.deleteMany({ where: { customerId: row.customerId } });
    // Any other outstanding link for this account dies with the old password.
    await tx.passwordResetToken.deleteMany({
      where: { customerId: row.customerId, tokenHash: { not: tokenHash } },
    });

    return row.customerId;
  });
}

/** The link that goes in the email. Built from the configured site URL, never from the request's Host header. */
export function resetLink(token: string): string {
  return `${siteUrl}/account/reset-password?token=${encodeURIComponent(token)}`;
}

export function resetEmail(name: string | null, link: string): { subject: string; text: string; html: string } {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const minutes = RESET_TOKEN_TTL_MS / 60_000;
  const subject = "Reset your VANTA password";

  const text = [
    greeting,
    "",
    "Someone asked to reset the password for your VANTA account. If that was you, open this link to choose a new one:",
    "",
    link,
    "",
    `The link works once and expires in ${minutes} minutes.`,
    "",
    "If you didn't ask for this, you can ignore this email — your password hasn't changed.",
    "",
    "— VANTA",
  ].join("\n");

  const safeLink = escapeHtml(link);
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#0d0d0d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;padding:32px">
    <tr><td>
      <p style="margin:0 0 24px;font-size:20px;font-weight:900;letter-spacing:2px">VANTA</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5">Someone asked to reset the password for your VANTA account. If that was you, choose a new one:</p>
      <p style="margin:0 0 24px"><a href="${safeLink}" style="display:inline-block;background:#0d0d0d;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Reset password</a></p>
      <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#555">The link works once and expires in ${minutes} minutes. If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all">${safeLink}</span></p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#555">If you didn't ask for this, ignore this email — your password hasn't changed.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}
