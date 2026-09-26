import { salesStats } from "@/lib/salesStats";
import { SalesOverview } from "@/components/admin/SalesOverview";
import { ContentOverview } from "@/components/admin/ContentOverview";

/**
 * Admin home (§49): the shop first, then the site.
 *
 * A server page now, so the sales numbers are read on the server. The content
 * half — draft state, publish, hero preview — is the client component this
 * page used to be, unchanged apart from its heading.
 */
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const stats = await salesStats();

  return (
    <div>
      <header className="mx-auto mb-8 max-w-6xl">
        <h1 className="font-admin-display text-2xl font-bold tracking-tight text-admin-ink">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-admin-muted">
          How the shop is doing, what needs doing, and the site&rsquo;s content.
        </p>
      </header>
      {stats && <SalesOverview stats={stats} />}
      <ContentOverview />
    </div>
  );
}
