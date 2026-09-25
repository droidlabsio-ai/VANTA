import "server-only";

/**
 * Sending email, through Resend's HTTP API. §44.
 *
 * `fetch`, not their SDK: one POST with a bearer token is the whole
 * integration, and a dependency for it would be a package to keep patched for
 * nothing. https://resend.com/docs/api-reference/emails/send-email
 *
 * **Without a domain of our own, Resend delivers only to the address that owns
 * the Resend account.** The default sender, `onboarding@resend.dev`, is their
 * shared testing address; anything sent from it to anyone else is refused with
 * a 403. That is enough to build and test every email flow. Real customers get
 * mail once a domain is verified in Resend and `EMAIL_FROM` names an address
 * on it — a configuration change, not a code change.
 *
 * Never throws. Every caller is a flow where the email is one step among
 * several, and the answer the visitor sees must not depend on whether a third
 * party answered — "if an account exists, we've sent a link" is shown either
 * way, precisely so that it reveals nothing. Failures are logged with the
 * provider's reason, which is where an operator will look.
 */

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/** Resend's shared testing sender. Works with no domain, to the owner only. */
const DEFAULT_FROM = "VANTA <onboarding@resend.dev>";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text is always sent: some clients show only it, and spam filters score its absence. */
  text: string;
  html: string;
}

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "not-configured" };

  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const error = `resend-http-${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`;
      console.error(`[email] send failed: ${error}`);
      return { ok: false, error };
    }

    const body = (await response.json().catch(() => ({}))) as { id?: unknown };
    return { ok: true, id: typeof body.id === "string" ? body.id : null };
  } catch {
    console.error("[email] send failed: resend-unreachable");
    return { ok: false, error: "resend-unreachable" };
  }
}

/** Escapes text for interpolation into an email's HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
