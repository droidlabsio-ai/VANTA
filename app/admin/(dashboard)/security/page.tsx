import { hasDatabase } from "@/lib/db";
import { getAdmin, listAdminSessions } from "@/lib/adminSession";
import { listAudit } from "@/lib/auditLog";
import { Card, CardHeader } from "@/components/admin/ui";
import { revokeAllOtherSessionsAction, revokeSessionAction } from "./actions";

/**
 * Sessions and the audit log.
 *
 * Read-only apart from revoking a session. The log is a record, and a record
 * with an edit button beside it is not evidence of anything.
 */
export const dynamic = "force-dynamic";

/** "2 hours ago", for a column where the exact second is never the question. */
function ago(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Turns a user-agent string into something readable.
 *
 * Deliberately crude. The question this column answers is "is that me?", and a
 * full parsing library for a browser name and an OS would be a dependency
 * carrying a device database for one line of text.
 */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : /Firefox\//.test(userAgent)
            ? "Firefox"
            : "Browser";
  const platform = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad/.test(userAgent)
      ? "iOS"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return platform ? `${browser} on ${platform}` : browser;
}

const ACTION_LABELS: Record<string, string> = {
  "admin.signin": "Signed in",
  "admin.signin.failed": "Failed sign-in",
  "admin.signout": "Signed out",
  "admin.session.revoked": "Revoked a session",
  "admin.session.revoked_all": "Signed out other devices",
  "content.publish": "Published changes",
  "content.draft.discarded": "Discarded draft",
  "media.uploaded": "Uploaded a photo",
  "media.deleted": "Deleted a photo",
  "courier.pushed": "Pushed an order to the courier",
  "courier.push_failed": "Courier push failed",
  "courier.queue_drained": "Drained the courier queue",
  "stock.updated": "Updated stock",
};

export default async function SecurityPage() {
  const admin = await getAdmin();
  // The layout above has already redirected if this is null; the check is here
  // so the types are honest rather than asserted away.
  if (!admin) return null;

  const [sessions, audit] = await Promise.all([
    listAdminSessions(admin.username, admin.sessionId),
    listAudit(100),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="font-admin-display text-2xl font-bold tracking-tight text-admin-ink">
          Security
        </h1>
        <p className="mt-1 text-sm text-admin-muted">
          Where you&rsquo;re signed in, and what has happened in the admin.
        </p>
      </header>

      {!hasDatabase() && (
        <Card>
          <div className="p-5">
            <p className="text-sm text-admin-ink">Sessions and the audit log need a database.</p>
            <p className="mt-2 text-sm text-admin-muted">
              Without one the admin still works, but a session can&rsquo;t be revoked
              and nothing is recorded. Set <code>DATABASE_URL</code> to turn both on.
            </p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Active sessions"
          hint="Each browser you've signed in from. Revoking one takes effect on its next page load."
        />
        <div className="p-5">
          {sessions.length === 0 ? (
            <p className="text-sm text-admin-muted">No sessions recorded.</p>
          ) : (
            <ul className="divide-y divide-admin-border">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-admin-ink">
                      {describeDevice(session.userAgent)}
                      {session.current && (
                        <span className="ml-2 rounded border border-admin-accent/30 bg-admin-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-admin-accent">
                          This device
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-admin-muted">
                      {session.ip ?? "unknown address"} &middot; signed in{" "}
                      {ago(session.createdAt)} &middot; last active {ago(session.lastSeenAt)}
                    </p>
                  </div>

                  {!session.current && (
                    <form action={revokeSessionAction}>
                      <input type="hidden" name="sessionId" value={session.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-admin-border-strong bg-admin-surface px-3 py-1.5 text-sm font-medium text-admin-ink transition-colors hover:bg-admin-surface-alt"
                      >
                        Revoke
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {sessions.length > 1 && (
            <form action={revokeAllOtherSessionsAction} className="mt-5">
              <button
                type="submit"
                className="rounded-lg bg-admin-accent px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-admin-accent-hover"
              >
                Sign out everywhere else
              </button>
              <p className="mt-2 text-xs text-admin-muted">
                Ends every session except this one. Use it if you&rsquo;ve signed in
                somewhere you no longer control.
              </p>
            </form>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Activity"
          hint="The last 100 things that happened. Read-only — nothing here can be edited or removed."
        />
        <div className="p-5">
          {audit.length === 0 ? (
            <p className="text-sm text-admin-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-admin-border text-sm">
              {audit.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-admin-subtle">
                    {ago(row.at)}
                  </span>
                  <span className="font-medium text-admin-ink">
                    {ACTION_LABELS[row.action] ?? row.action}
                  </span>
                  <span className="text-admin-muted">{row.actor}</span>
                  {row.target && (
                    <span className="truncate text-xs text-admin-subtle">{row.target}</span>
                  )}
                  <span className="ml-auto text-xs text-admin-subtle">{row.ip ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
