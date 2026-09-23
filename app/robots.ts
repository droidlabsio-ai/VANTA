import type { MetadataRoute } from "next";
import { siteUrl, siteUrlIsPlaceholder } from "@/lib/siteUrl";

/**
 * robots.txt.
 *
 * The disallow list mirrors the `noindex` routes in `lib/seo.ts`, and the two
 * do different jobs rather than duplicating each other: `noindex` stops a page
 * being *listed*, this stops it being *fetched*. Both are wanted here. An order
 * page is not merely uninteresting to a crawler — it holds somebody's name,
 * address and phone number, and the cheapest protection is for the crawler
 * never to request it.
 *
 * `/api` is disallowed for a different reason again: those routes take webhooks
 * and run scheduled work. Nothing good comes of a crawler probing them, and
 * they answer with real HTTP status codes that a crawler will happily retry.
 */

/**
 * Refuses to emit anything pointing at localhost.
 *
 * With no `NEXT_PUBLIC_SITE_URL`, `siteUrl` resolves to `http://localhost:3000`
 * and every absolute URL this file can build is wrong. A robots.txt whose
 * `Sitemap:` line points at localhost is worse than none at all: it is a live,
 * cacheable instruction that resolves to nothing, and the crawler has no way to
 * tell it apart from a real one. `lib/siteUrl.ts` exposes the flag precisely so
 * this decision can be made rather than assumed.
 *
 * The fallback still disallows everything private, so a deployment that forgets
 * the variable is under-configured rather than exposed.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [
    "/admin",
    "/checkout",
    "/account",
    "/orders",
    "/bag",
    "/wishlist",
    "/api",
    /**
     * `/_next/` is deliberately NOT here (§43). It was, on the reasoning that it
     * is only Next's client-navigation data endpoint — but the same prefix serves
     * every CSS and JS chunk (`/_next/static`) and every optimised image
     * (`/_next/image`). Blocking it stopped Google rendering the pages with their
     * styles and kept every product photo out of Google Images, since every
     * `<img>` on the site points at `/_next/image`.
     */
  ];

  if (siteUrlIsPlaceholder) {
    return { rules: [{ userAgent: "*", allow: "/", disallow }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
