import "server-only";

import { headers } from "next/headers";
import { hasDatabase, prisma } from "@/lib/db";

/**
 * The admin audit log.
 *
 * Answers "who changed this, when, and from where" after the fact — which is
 * the question nobody can answer from the content store alone, because a
 * published document only records its current state.
 *
 * **Never records a credential.** No passwords, no session tokens, no captcha
 * secrets, no raw request bodies. A log that contains secrets is a second place
 * to steal them from, and its whole value is that it can be read freely.
 */

/**
 * Actions, written down once.
 *
 * A union rather than free strings: an audit log where one publish is
 * "content.publish" and another is "publish_content" cannot be filtered, and
 * the mistake is invisible until someone needs it.
 */
export type AuditAction =
  | "admin.signin"
  | "admin.signin.failed"
  | "admin.signout"
  | "admin.session.revoked"
  | "admin.session.revoked_all"
  | "content.publish"
  | "content.draft.discarded"
  | "media.uploaded"
  | "media.deleted"
  | "courier.pushed"
  | "courier.push_failed"
  | "courier.queue_drained"
  | "stock.updated"
  | "payment.refunded"
  | "payment.refund_failed"
  | "order.status_changed"
  | "order.cancelled";

export interface AuditEntry {
  actor: string;
  action: AuditAction;
  target?: string;
  detail?: Record<string, unknown>;
}

/** Best-effort request context. Both headers are spoofable off Vercel — §17. */
async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    return {
      ip: forwarded?.split(",")[0].trim() ?? headerList.get("x-real-ip") ?? null,
      userAgent: headerList.get("user-agent")?.slice(0, 255) ?? null,
    };
  } catch {
    // Called from somewhere with no request scope, such as a script.
    return { ip: null, userAgent: null };
  }
}

/**
 * Writes an entry.
 *
 * Never throws. Auditing is a record of the work, not part of it: an action
 * that succeeded and then failed to log has still succeeded, and turning that
 * into an error the operator sees would make the log a new way for publishing
 * to break.
 *
 * The trade is that a failed write is silent, which is the wrong answer for a
 * log used as tamper-evidence. It is the right one here, where this is an
 * operational record for a single administrator.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (!hasDatabase()) return;
  try {
    const { ip, userAgent } = await requestContext();
    await prisma.adminAuditLog.create({
      data: {
        actor: entry.actor.slice(0, 190),
        action: entry.action,
        target: entry.target?.slice(0, 190) ?? null,
        detail: (entry.detail ?? undefined) as never,
        ip,
        userAgent,
      },
    });
  } catch {
    // Deliberately swallowed — see above.
  }
}

export interface AuditRow {
  id: string;
  at: Date;
  actor: string;
  action: string;
  target: string | null;
  detail: unknown;
  ip: string | null;
  userAgent: string | null;
}

/** Newest first, capped. The page is a recent history, not an export. */
export async function listAudit(limit = 100): Promise<AuditRow[]> {
  if (!hasDatabase()) return [];
  return prisma.adminAuditLog.findMany({
    orderBy: { at: "desc" },
    take: Math.min(limit, 500),
  });
}
