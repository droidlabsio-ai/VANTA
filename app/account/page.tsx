import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { redirect } from "next/navigation";
import { contentStore } from "@/lib/contentStore";
import { prisma } from "@/lib/db";
import { getCustomer } from "@/lib/auth/customerSession";
import { readCustomerData } from "@/lib/auth/customerData";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BottomNav } from "@/components/BottomNav";
import { AddressBook } from "@/components/account/AddressBook";
import { OrderHistory } from "@/components/account/OrderHistory";
import { SignOutButton } from "@/components/account/SignOutButton";

export const metadata: Metadata = pageMetadata({
  title: "Your account",
  description:
    "Your VANTA order history, saved delivery addresses and account details, with tracking for anything currently on its way to you.",
  path: "/account",
  noindex: true,
});

/**
 * The account page.
 *
 * Signed-out visitors are redirected rather than shown a sign-in form in place.
 * The two are different pages with different metadata and different intent, and
 * a URL that means either one depending on a cookie is a URL nobody can link to.
 */
/**
 * Never prerendered, and never cached.
 *
 * This page is per-customer by definition. It became static in a build because
 * nothing in it reached `cookies()`: `getCustomer()` returns early when no
 * database is configured, so the request-time API that would have marked the
 * route dynamic was never called, and Next prerendered a page whose whole
 * purpose is to differ per person.
 *
 * Relying on a function's internals to opt a route out of prerendering is the
 * kind of coupling that breaks quietly — as it already did here. Stated
 * explicitly instead.
 */
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const customer = await getCustomer();
  if (!customer) redirect("/account/login?next=/account");

  const [{ homepage }, addresses, saved, orderRows] = await Promise.all([
    contentStore.read(),
    prisma.address.findMany({
      where: { customerId: customer.id },
      // Default first, then oldest — the order a checkout would present them in.
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        fullName: true,
        phone: true,
        line1: true,
        line2: true,
        city: true,
        state: true,
        pincode: true,
        isDefault: true,
      },
    }),
    readCustomerData(customer.id),
    /**
     * Only what the list needs. Pulling every line of every order to show a
     * count would grow with the customer's history for no visible gain.
     */
    prisma.order.findMany({
      where: { customerId: customer.id },
      orderBy: { placedAt: "desc" },
      take: 50,
      select: {
        orderNumber: true,
        placedAt: true,
        status: true,
        total: true,
        _count: { select: { items: true } },
      },
    }),
  ]);

  const bagCount = saved.bag.reduce((total, line) => total + line.qty, 0);

  const orders = orderRows.map((row) => ({
    orderNumber: row.orderNumber,
    placedAt: row.placedAt,
    status: row.status,
    total: row.total,
    itemCount: row._count.items,
  }));

  return (
    <div className="storefront-shell">
      <Navbar nav={homepage.nav} />

      <main id="main" className="pt-[calc(var(--header-h)+2rem)]">
        <div className="mx-auto w-full max-w-[720px] px-gutter pb-24 lg:pb-32">
          <p className="eyebrow">Account</p>
          <h1 className="mt-2 headline text-display-sm lg:text-display-md">
            {customer.name ?? "Welcome back"}
          </h1>
          <p className="mt-3 text-sm text-bone/50">{customer.email}</p>

          {/* What the account is currently holding, stated plainly. This is the
              whole visible payoff of signing in, so it should not be buried. */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SummaryTile label="In your bag" value={String(bagCount)} href="/bag" />
            <SummaryTile
              label="Saved items"
              value={String(saved.wishlist.length)}
              href="/wishlist"
            />
            <SummaryTile label="Addresses" value={String(addresses.length)} />
          </div>

          <hr className="my-10 border-ink-line" />

          <AddressBook addresses={addresses} />

          <hr className="my-10 border-ink-line" />

          <section>
            <h2 className="headline text-2xl">Orders</h2>
            <div className="mt-4">
              <OrderHistory orders={orders} />
            </div>
          </section>

          <hr className="my-10 border-ink-line" />

          <SignOutButton />
        </div>
      </main>

      <Footer content={homepage.footer} />
      <BottomNav items={homepage.nav.bottomNav} />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-label font-bold uppercase tracking-[0.14em] text-bone/40">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-black">{value}</p>
    </>
  );

  return href ? (
    <Link
      href={href}
      className="rounded-xl border border-ink-line bg-ink-soft p-4 transition-colors hover:border-bone/30"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-ink-line bg-ink-soft p-4">{body}</div>
  );
}
