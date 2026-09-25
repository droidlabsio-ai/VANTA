import type { Metadata } from "next";
import { contentStore } from "@/lib/contentStore";
import { pageMetadata } from "@/lib/seo";
import { leafCategories, withProductCounts } from "@/lib/catalogue";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Lookbook } from "@/components/Lookbook";
import { BrandStatement } from "@/components/BrandStatement";
import { ProductRail } from "@/components/ProductRail";
import { TrustStrip } from "@/components/TrustStrip";
import { CategoryList } from "@/components/CategoryList";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { ScrollEngine } from "@/components/scroll/ScrollEngine";
import { EnvironmentMorph } from "@/components/scroll/EnvironmentMorph";
import { PinnedHero } from "@/components/scroll/PinnedHero";
import { ParallaxGroup } from "@/components/scroll/Parallax";
import { KineticMarquee } from "@/components/scroll/KineticMarquee";
import { CurtainReveal } from "@/components/scroll/CurtainReveal";
import { ApertureReveal } from "@/components/scroll/ApertureReveal";
import { RiseIn } from "@/components/scroll/RiseIn";
import { SlideRows } from "@/components/scroll/SlideRows";
import { WordmarkFinale } from "@/components/scroll/WordmarkFinale";
import { ChapterIndex } from "@/components/scroll/ChapterIndex";

/**
 * The homepage was the **only** non-admin route with no metadata of its own.
 *
 * It inherited `title.default` from the root layout, which meant the most
 * important page on the site had the least specific title and no canonical at
 * all — so `/?utm_source=…` and `/` competed as separate URLs.
 *
 * The title leads with what VANTA sells rather than the brand name: somebody
 * searching "technical streetwear india" has never heard of us, and a title
 * that opens with a word they did not search for wastes the only line they
 * read.
 *
 * The brand is written in explicitly, unlike every other route. `title.template`
 * only applies to **child** segments, and `app/page.tsx` shares the root
 * segment with `app/layout.tsx` — measured, the rendered title came out as
 * "Technical Streetwear, Made in Mumbai" with no brand at all. Every other page
 * gets the suffix from the template and must not repeat it.
 */
export const metadata: Metadata = pageMetadata({
  title: "Technical Streetwear, Made in Mumbai | VANTA",
  description:
    "Shell jackets, cargo pants and utility rigs built for the Indian street. Cash on delivery pan-India, free shipping over ₹1,999, seven-day returns.",
  path: "/",
});

/**
 * The homepage is a thin composition layer: it reads the published content from
 * the content store and hands each section exactly what it needs. No copy or
 * imagery lives here.
 *
 * It reads the store rather than importing `/data` directly so that publishing
 * from `/admin` actually changes the page. `/data` is only the store's seed.
 *
 * The scroll scenes wrap sections rather than replacing them — each section is
 * still a server component, and the cinematic wrappers are client leaves that
 * only animate what's already been rendered (DECISIONS.md §13, §18).
 *
 * Motion score:
 *   1. Hero          pinned — camera pulls back, copy lifts, frame dims
 *   2. Lookbook      multi-depth parallax across the three looks
 *   3. Brand stmt    slow camera move over a single portrait
 *   4. Product rail  gentle lift, no pin — the eye needs to read prices here
 *   5. Trust         a quiet beat, deliberately still
 *   6. Categories    the environment has cooled to graphite by now
 */
/** The spine down the left edge. Ids must match the section wrappers below. */
const CHAPTERS = [
  { id: "chapter-hero", label: "Made to Move" },
  { id: "chapter-lookbook", label: "The Looks" },
  { id: "chapter-series", label: "Series 026" },
  { id: "chapter-shop", label: "The Kit" },
  { id: "chapter-categories", label: "Browse" },
];

export default async function HomePage() {
  const { homepage, products } = await contentStore.read();

  // Resolve the rail's product ids against the published catalogue, in the
  // order the rail lists them. Unknown ids are dropped rather than rendered as
  // holes; publish-time validation should mean there are none.
  const byId = new Map(products.map((p) => [p.id, p]));
  const railProducts = homepage.productRail.productIds
    .map((id) => byId.get(id))
    .filter((p) => p !== undefined);

  /**
   * The marquee's words come from the published content, not from code: the
   * hero headline's lines, then the trust points. An editor changing either
   * changes the band. §45.
   */
  const marqueeRows = [
    homepage.hero.headline.map((line) => line.map((seg) => seg.text).join("").trim()),
    homepage.trust.items.map((item) => item.title),
  ].filter((row) => row.length > 0);

  return (
    <div className="storefront-shell">
      <ScrollEngine />
      <EnvironmentMorph />
      <ChapterIndex chapters={CHAPTERS} />

      <Navbar nav={homepage.nav} />
      <main id="main">
        {/*
          The motion score, top to bottom (§45): the hero pins and the camera
          pulls back → a band of type slides past → the looks are wiped open
          one by one → Series 026 opens like a shutter → the kit rises into
          place → the categories slide in → the name, full width, to close.
        */}
        <div id="chapter-hero">
          <PinnedHero>
            <Hero hero={homepage.hero} />
          </PinnedHero>
        </div>

        {marqueeRows.length > 0 && <KineticMarquee rows={marqueeRows} />}

        <ParallaxGroup className="scroll-mt-24">
          <div id="chapter-lookbook">
            <CurtainReveal>
              <Lookbook slides={homepage.lookbook.slides} />
            </CurtainReveal>
          </div>
        </ParallaxGroup>

        <div id="chapter-series">
          <ApertureReveal>
            <BrandStatement content={homepage.brandStatement} />
          </ApertureReveal>
        </div>

        <RiseIn>
          <ParallaxGroup distance={40}>
            <div id="chapter-shop">
              <ProductRail content={homepage.productRail} products={railProducts} />
            </div>
          </ParallaxGroup>
        </RiseIn>

        <TrustStrip items={homepage.trust.items} />

        <div id="chapter-categories">
          {/* Leaves only. A group holds no products of its own, so a row for
              it would open a page listing the same garments as the rows
              beneath it. */}
          <SlideRows>
            <CategoryList
              heading={homepage.categories.heading}
              items={leafCategories(withProductCounts(homepage.categories.items, products))}
            />
          </SlideRows>
        </div>

        <WordmarkFinale word={homepage.footer.wordmark} />
      </main>
      <Footer content={homepage.footer} />
      <BottomNav items={homepage.nav.bottomNav} />
    </div>
  );
}
