import Link from "next/link";
import { formatPaise } from "@/lib/money";
import { LOW_STOCK, type SalesStats } from "@/lib/salesStats";
import { Card, CardHeader } from "@/components/admin/ui";

/**
 * Sales at a glance, on the admin home page (§49).
 *
 * Order of the page is the order of the questions: is anything waiting on me
 * (to pack, to refund), how are we doing (today, 30 days), what is selling,
 * and what is about to run out. The daily chart is one series in the admin
 * accent — one hue, no legend needed, the title names it — with a hover
 * readout per bar and the exact figures in a table for anyone who wants them.
 */
export function SalesOverview({ stats }: { stats: SalesStats }) {
  const todo = [
    { label: "To pack", value: stats.todo.toPack, href: "/admin/orders?show=to-pack", urgent: false },
    {
      label: "Refund needed",
      value: stats.todo.refundNeeded,
      href: "/admin/orders?show=closed",
      urgent: stats.todo.refundNeeded > 0,
    },
    {
      label: "Awaiting payment",
      value: stats.todo.awaitingPayment,
      href: "/admin/orders?show=unpaid",
      urgent: false,
    },
  ];

  const tiles = [
    { label: "Sales today", value: formatPaise(stats.today.revenue), sub: plural(stats.today.orders, "order") },
    { label: "Last 30 days", value: formatPaise(stats.month.revenue), sub: plural(stats.month.orders, "order") },
    { label: "Average order", value: formatPaise(stats.month.average), sub: "last 30 days" },
  ];

  return (
    <section className="mx-auto mb-10 max-w-6xl space-y-6">
      <h2 className="font-admin-display text-lg font-bold tracking-tight text-admin-ink">Sales</h2>

      <div className="grid gap-4 sm:grid-cols-3">
        {todo.map((t) => (
          <Link key={t.label} href={t.href} className="group">
            <Card className="flex items-center justify-between p-4 transition-colors group-hover:border-admin-border-strong">
              <span className={t.urgent ? "text-sm font-semibold text-admin-danger" : "text-sm text-admin-muted"}>
                {t.label}
              </span>
              <span
                className={
                  t.urgent
                    ? "font-admin-display text-2xl font-bold text-admin-danger"
                    : "font-admin-display text-2xl font-bold text-admin-ink"
                }
              >
                {t.value}
              </span>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.label} className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-subtle">{t.label}</p>
            <p className="mt-2 font-admin-display text-3xl font-bold tabular-nums text-admin-ink">{t.value}</p>
            <p className="mt-1 text-xs text-admin-muted">{t.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Card>
          <CardHeader title="Sales per day" hint={`Last ${stats.daily.length} days, India time`} />
          <DailyChart daily={stats.daily} />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Best sellers" hint="Pieces sold, last 30 days" />
            {stats.bestSellers.length === 0 ? (
              <p className="p-5 text-sm text-admin-muted">No sales in the last 30 days.</p>
            ) : (
              <ol className="divide-y divide-admin-border">
                {stats.bestSellers.map((b, i) => (
                  <li key={b.title} className="flex items-baseline gap-3 px-5 py-3 text-sm">
                    <span className="w-4 tabular-nums text-admin-subtle">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-admin-ink">{b.title}</span>
                    <span className="tabular-nums text-admin-ink">{b.quantity}</span>
                    <span className="w-20 text-right tabular-nums text-admin-muted">{formatPaise(b.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader title="Running low" hint={`Counted sizes at ${LOW_STOCK} or fewer`} />
            {stats.lowStock.length === 0 ? (
              <p className="p-5 text-sm text-admin-muted">
                Nothing low. Only sizes you count on the Stock page appear here.
              </p>
            ) : (
              <ul className="divide-y divide-admin-border">
                {stats.lowStock.slice(0, 8).map((s) => (
                  <li key={s.sku} className="flex items-baseline gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-admin-ink">
                      {s.product}
                      {s.size && <span className="text-admin-muted"> · {s.size}</span>}
                    </span>
                    <span
                      className={
                        s.quantity === 0
                          ? "text-xs font-semibold uppercase text-admin-danger"
                          : "tabular-nums text-admin-ink"
                      }
                    >
                      {s.quantity === 0 ? "Sold out" : `${s.quantity} left`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-admin-border px-5 py-3">
              <Link href="/admin/stock" className="text-xs font-medium text-admin-accent hover:underline">
                Update stock →
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Bars, one per day. Server-rendered HTML rather than a chart library: 14
 * bars don't need one. Each bar is a focusable element whose tooltip shows the
 * day, amount and order count on hover or keyboard focus; the axis carries
 * only the first, middle and last dates so labels never collide; the table
 * below (collapsed) has every figure.
 */
function DailyChart({ daily }: { daily: SalesStats["daily"] }) {
  const max = Math.max(...daily.map((d) => d.revenue), 0);
  const showLabel = (i: number) => i === 0 || i === daily.length - 1 || i === Math.floor(daily.length / 2);

  if (max === 0) {
    return <p className="p-5 text-sm text-admin-muted">No sales in this period yet.</p>;
  }

  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between text-[11px] text-admin-subtle">
        <span>{formatPaise(max)}</span>
      </div>
      <div className="relative mt-1 h-48 border-b border-admin-border-strong">
        {/* Recessive guide at the top of the scale */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-admin-border" />
        <ul className="absolute inset-0 flex items-end gap-[2px]" aria-label="Sales per day">
          {daily.map((d) => {
            const height = d.revenue === 0 ? 0 : Math.max(2, (d.revenue / max) * 100);
            return (
              <li key={d.label} className="group relative flex h-full flex-1 items-end justify-center">
                <span
                  tabIndex={0}
                  aria-label={`${d.label}: ${formatPaise(d.revenue)}, ${d.orders} orders`}
                  className="block w-full max-w-7 rounded-t bg-admin-accent outline-none transition-opacity group-hover:opacity-80 focus-visible:ring-2 focus-visible:ring-admin-ink"
                  style={{ height: `${height}%` }}
                />
                {/* Hit target is the whole column, taller than the bar. */}
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md bg-admin-ink px-2 py-1 text-[11px] text-white group-focus-within:block group-hover:block"
                >
                  {d.label} · {formatPaise(d.revenue)} · {d.orders} {d.orders === 1 ? "order" : "orders"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-1 flex gap-[2px] text-[11px] text-admin-subtle">
        {daily.map((d, i) => (
          <span key={d.label} className="flex-1 whitespace-nowrap text-center">
            {showLabel(i) ? d.label : ""}
          </span>
        ))}
      </div>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-admin-muted">Show as a table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-admin-subtle">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Orders</th>
              <th className="py-1 text-right font-medium">Sales</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.label} className="border-t border-admin-border text-admin-ink">
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-right tabular-nums">{d.orders}</td>
                <td className="py-1 text-right tabular-nums">{formatPaise(d.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
