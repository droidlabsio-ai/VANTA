import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { contentStore } from "@/lib/contentStore";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BottomNav } from "@/components/BottomNav";
import { BagContents } from "@/components/BagContents";
import { soldOutSkus } from "@/lib/stock";

export const metadata: Metadata = pageMetadata({
  title: "Bag",
  description:
    "The pieces you have chosen, with a delivery estimate for your pincode. Cash on delivery pan-India and free shipping on orders over ₹1,999.",
  path: "/bag",
  noindex: true,
});

/**
 * The bag.
 *
 * A server component that does one thing the client cannot: read the published
 * catalogue. The bag itself is browser-local, so the lines are rendered by a
 * client child — this page just hands it today's products to resolve them
 * against.
 *
 * The whole catalogue is passed rather than only the products in the bag,
 * because the server has no way of knowing what is in the bag. It is a few
 * kilobytes of already-public data.
 */
export const dynamic = "force-dynamic";

export default async function BagPage() {
  const [{ homepage, products }, soldOut] = await Promise.all([
    contentStore.read(),
    // Stock changes with every order, so this page is never served from cache.
    soldOutSkus(),
  ]);

  return (
    <div className="storefront-shell">
      <Navbar nav={homepage.nav} />

      <main id="main" className="pt-[calc(var(--header-h)+2rem)]">
        <div className="px-gutter pb-16 lg:px-gutter-lg lg:pb-24">
          <h1 className="headline text-display-sm lg:text-display-md">Bag</h1>
          <div className="mt-8">
            <BagContents catalogue={products} soldOut={soldOut} />
          </div>
        </div>
      </main>

      <Footer content={homepage.footer} />
      <BottomNav items={homepage.nav.bottomNav} />
    </div>
  );
}
