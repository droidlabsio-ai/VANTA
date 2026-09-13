import { z } from "zod";
import type {
  BrandStatementContent,
  CollectionPageContent,
  HeroContent,
  HomepageContent,
  Product,
  ProductVariant,
} from "@/data/types";
import type { SiteContent } from "./contentStore";
import { isBrokenHref } from "./linkHref";

/**
 * Runtime validation for anything arriving from a browser.
 *
 * The publish action is behind a session, but an authenticated request is still
 * an untrusted one: the payload is JSON assembled on the client and can be
 * anything. Unvalidated content would reach the storefront and break it — a
 * bogus `backdrop`, for instance, indexes `backdropClass` to `undefined`.
 *
 * Every schema below is pinned to its TypeScript counterpart with
 * `satisfies z.ZodType<T>`. If `data/types.ts` gains or changes a field and
 * this file isn't updated, the build fails — the validator cannot silently
 * drift away from the schema it is meant to enforce.
 */

/**
 * Published content and drafts need different strictness, so the schema is
 * built twice from one definition.
 *
 * A draft is work in progress. Someone clearing a headline to retype it has an
 * empty required field for a few seconds, and refusing to save at that moment
 * would lose exactly the work autosave exists to protect. Drafts therefore
 * check *shape* — right fields, right types, valid enums — and skip the
 * "must not be blank" rules. Publishing enforces the full set, so nothing
 * incomplete can reach the storefront.
 */
function build(strict: boolean) {
/** Trimmed, and required to still have content — a blank headline is a bug. */
const nonEmpty = strict ? z.string().trim().min(1) : z.string();
/** Alt text is intentionally allowed to be empty: that marks it decorative. */
const altText = z.string();

/**
 * A link address.
 *
 * Only the unambiguously-broken shape is refused — a scheme buried inside a
 * path, like "/https:example.com", which is a valid path that can only ever
 * 404. Whether "/collections/new" exists is not knowable here, and this
 * project links to plenty of routes that do not exist yet on purpose.
 *
 * Publish-time only: a draft may hold a half-typed address.
 */
const hrefField = strict
  ? nonEmpty.refine((v) => !isBrokenHref(v), {
      message:
        "Looks like a web address inside a page path — it would open a “page not found”.",
    })
  : z.string();

const backdrop = z.enum(["red", "orange", "sunset", "graphite"]);

const imageAsset = z.object({
  src: nonEmpty,
  alt: altText,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurDataURL: z.string().optional(),
});

const link = z.object({
  label: nonEmpty,
  href: hrefField,
  external: z.boolean().optional(),
});

const cta = z.object({ label: nonEmpty, href: hrefField });

const headlineSegment = z.object({ text: z.string(), accent: z.boolean().optional() });
/** A line is a list of segments; a headline is a list of lines. */
const headline = z.array(z.array(headlineSegment).min(1)).min(1);

const heroContent = z.object({
  headline,
  description: z.string(),
  cta,
  image: imageAsset,
  backdrop,
}) satisfies z.ZodType<HeroContent>;

const lookSlide = z.object({
  id: nonEmpty,
  image: imageAsset,
  backdrop,
  caption: z.string(),
  href: nonEmpty,
});

const brandStatement = z.object({
  eyebrow: z.string(),
  headline,
  description: z.string(),
  cta,
  image: imageAsset,
  backdrop,
}) satisfies z.ZodType<BrandStatementContent>;

const variant = z.object({
  size: nonEmpty,
  sku: nonEmpty,
  // Whole rupees, like `price`. Positive at publish, not merely non-negative:
  // a size that costs nothing is a typo, not a promotion.
  price: (strict ? z.number().int().positive() : z.number().int().nonnegative()).optional(),
}) satisfies z.ZodType<ProductVariant>;

const product = z.object({
  id: nonEmpty,
  name: nonEmpty,
  categoryId: nonEmpty,
  price: z.number().int().nonnegative(),
  compareAtPrice: z.number().int().nonnegative().optional(),
  image: imageAsset,
  backdrop,
  href: nonEmpty,
  codAvailable: z.boolean(),
  badge: z.string().optional(),
  // Written by the server, never by a form, so this only has to be a valid
  // date string — an editor cannot put anything else here.
  badgeSetAt: z.iso.datetime().optional(),
  // At least one size to publish: a product with none cannot be bought, and
  // would reach the storefront as a page with nothing to add to the bag. A
  // draft may have none — someone rebuilding a size list empties it first.
  variants: strict ? z.array(variant).min(1, "Needs at least one size.") : z.array(variant),
}) satisfies z.ZodType<Product>;

const productRail = z.object({
  headline,
  viewAll: link,
  productIds: z.array(nonEmpty),
});

const trustItem = z.object({
  id: nonEmpty,
  icon: z.enum(["shipping", "returns", "cod", "secure"]),
  title: nonEmpty,
  detail: z.string(),
});

const category = z.object({
  id: nonEmpty,
  name: nonEmpty,
  href: nonEmpty,
  image: imageAsset,
  // No `itemCount`: counts are derived from the catalogue, never stored. A
  // published document that still carries one is stripped here on the next
  // publish, which is the intended cleanup path. §30.
  parentId: z.string().optional(),
  // Page-level extras. Optional, and an empty description is meaningful —
  // it means "no intro on this collection page", not an unfinished field.
  description: z.string().optional(),
  banner: imageAsset.optional(),
});

const navContent = z.object({
  wordmark: nonEmpty,
  links: z.array(link),
  bottomNav: z.array(
    z.object({
      id: nonEmpty,
      icon: z.enum(["home", "shop", "wishlist", "bag"]),
      label: nonEmpty,
      href: nonEmpty,
    }),
  ),
});

const footerContent = z.object({
  wordmark: nonEmpty,
  tagline: z.string(),
  links: z.array(link),
  copyright: z.string(),
});

const collectionPageContent = z.object({
  indexHeading: nonEmpty,
  indexIntro: z.string(),
  emptyMessage: nonEmpty,
  emptyCtaLabel: nonEmpty,
  showCount: z.boolean(),
  viewNames: z.object({ all: nonEmpty, new: nonEmpty, sale: nonEmpty }),
}) satisfies z.ZodType<CollectionPageContent>;

const homepageContent = z.object({
  nav: navContent,
  hero: heroContent,
  lookbook: z.object({ slides: z.array(lookSlide) }),
  brandStatement,
  productRail,
  trust: z.object({ items: z.array(trustItem) }),
  categories: z.object({ heading: nonEmpty, items: z.array(category) }),
  footer: footerContent,
}) satisfies z.ZodType<HomepageContent>;

return z
  .object({
    homepage: homepageContent,
    collectionPage: collectionPageContent,
    products: z.array(product),
  })
  /**
   * Cross-field rule the per-field schemas cannot express: the rail references
   * products by id, so every id it lists must actually exist. Without this a
   * publish could leave the rail pointing at a deleted product.
   */
  .superRefine((value, ctx) => {
    // Cross-field rules are publish-time only: a draft mid-reorder can
    // legitimately reference a product that hasn't been added back yet.
    if (!strict) return;

    const cats = value.homepage.categories.items;
    const categoryIds = new Set(cats.map((c) => c.id));

    /**
     * Groups are one level deep, and a category cannot be its own parent.
     * Both would otherwise produce a collection page that recurses or renders
     * a category inside itself.
     */
    const hasParent = new Set(cats.flatMap((c) => (c.parentId ? [c.id] : [])));
    cats.forEach((c, i) => {
      if (!c.parentId) return;
      const at = ["homepage", "categories", "items", i, "parentId"];
      if (c.parentId === c.id) {
        ctx.addIssue({ code: "custom", path: at, message: `"${c.name}" cannot be its own group.` });
        return;
      }
      if (!categoryIds.has(c.parentId)) {
        ctx.addIssue({
          code: "custom",
          path: at,
          message: `"${c.name}" is in group "${c.parentId}", which doesn't exist.`,
        });
        return;
      }
      if (hasParent.has(c.parentId)) {
        ctx.addIssue({
          code: "custom",
          path: at,
          message: `"${c.name}" is inside a category that is itself in a group. Only one level is supported.`,
        });
      }
    });

    value.products.forEach((p, i) => {
      if (!categoryIds.has(p.categoryId)) {
        ctx.addIssue({
          code: "custom",
          path: ["products", i, "categoryId"],
          message: `"${p.name}" is in category "${p.categoryId}", which doesn't exist.`,
        });
      }
    });

    const ids = new Set(value.products.map((p) => p.id));
    value.homepage.productRail.productIds.forEach((id, i) => {
      if (!ids.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["homepage", "productRail", "productIds", i],
          message: `Product rail references unknown product "${id}".`,
        });
      }
    });

    const seen = new Set<string>();
    value.products.forEach((p, i) => {
      if (seen.has(p.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["products", i, "id"],
          message: `Duplicate product id "${p.id}".`,
        });
      }
      seen.add(p.id);
    });

    /**
     * Sizes unique within a product; SKUs unique across the whole catalogue.
     *
     * The SKU rule is why these live here rather than on the variant schema: a
     * single product cannot see any other product's SKUs, and uniqueness
     * *within* one product would pass two products that both sell a
     * "VNT-APXTS-M". This is also the check that actually guarantees
     * uniqueness — `makeSku` is collision-free across today's ids, which is a
     * fact about the current catalogue and not a promise about the next one.
     *
     * Compared trimmed and case-folded: "m" and "M" are one size to a shopper,
     * and "vnt-apxts-m" is the same SKU as "VNT-APXTS-M" to a scanner.
     */
    const skuOwner = new Map<string, string>();
    value.products.forEach((p, i) => {
      const sizes = new Set<string>();
      p.variants.forEach((v, j) => {
        const size = v.size.trim().toUpperCase();
        if (sizes.has(size)) {
          ctx.addIssue({
            code: "custom",
            path: ["products", i, "variants", j, "size"],
            message: `"${p.name}" lists size "${v.size}" more than once.`,
          });
        }
        sizes.add(size);

        const sku = v.sku.trim().toUpperCase();
        const owner = skuOwner.get(sku);
        if (owner === undefined) {
          skuOwner.set(sku, p.id);
        } else {
          ctx.addIssue({
            code: "custom",
            path: ["products", i, "variants", j, "sku"],
            message:
              owner === p.id
                ? `"${p.name}" uses SKU "${v.sku}" for two sizes.`
                : `SKU "${v.sku}" on "${p.name}" is already used by product "${owner}".`,
          });
        }
      });
    });
  }) satisfies z.ZodType<SiteContent>;
}

/** Full rules. Used by publish — nothing incomplete reaches the storefront. */
export const siteContentSchema = build(true);

/** Shape only. Used by draft saves, which must tolerate work in progress. */
export const draftContentSchema = build(false);
