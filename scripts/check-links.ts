/**
 * Checks every internal link in the **published** content and reports the dead
 * ones.
 *
 *     npm run content:check-links
 *
 * This exists because the "Shop Series 026" button on the homepage has now been
 * reported dead twice by a person looking at the site. The first fix changed
 * `data/homepage.ts`, which is only the *seed* — once anything has been
 * published, `.content/site.json` (or the `ContentDocument` row) is what the
 * storefront reads and `/data` is never consulted again. So the repo looked
 * fixed and the running site was not. DECISIONS §31.
 *
 * Deliberately a script rather than a publish-time refusal. An editor can
 * legitimately point a link at a product they are about to add, and failing
 * their publish for it would be worse than telling them afterwards. This is
 * cheap to run in CI or before a deploy, and it reads the same store the
 * storefront does — file or Postgres, whichever is configured.
 *
 * ## Why it refuses to pass ambiguously — §34
 *
 * "Reads the same store the storefront does" was true of the code and false in
 * practice, because **the store is chosen from the environment at the moment
 * this runs**. `selectStore()` picks Postgres only when `DATABASE_URL` is
 * visible; otherwise it silently returns the file adapter, which on a fresh
 * checkout finds no `.content/site.json` and falls back to the `/data` seed.
 *
 * On Vercel that is not hypothetical — though not for the reason this comment
 * used to give. It claimed build-time and runtime variables are "separate
 * scopes"; they are not. Vercel's only scoping axis is Production / Preview /
 * Development, and a variable scoped to an environment is available to that
 * deployment both during the build step and at runtime. (`Sensitive`/`Secret`
 * typing does not change that either — those values are present during builds,
 * which is why Vercel redacts them from build *logs*.)
 *
 * The real way `DATABASE_URL` goes missing here is the environment axis.
 * Marketplace resources — Neon among them — can be connected to Production
 * only, which removes non-production access, so a Preview build runs with no
 * `DATABASE_URL` at all. The check would then validate the seed, print "all
 * resolve", and pass green — while the published document it was invoked to
 * verify went entirely unread. That is the §31 failure reintroduced by the tool
 * written to prevent it, and a silent pass is worse than no check at all.
 *
 * So it now reports what it read, and separates two states that look identical
 * from outside:
 *
 * - **Nothing has ever been published.** The seed genuinely *is* what will be
 *   served. Legitimate — passes, and says so.
 * - **A database was expected and could not be reached.** Fails loudly, having
 *   checked nothing, because passing would be a lie.
 *
 * Run through `tsx --conditions=react-server`, which is what makes the
 * `import "server-only"` guard inside `lib/contentStore.ts` resolve to a no-op.
 * A plain `tsx` invocation throws there. It is a node resolution flag rather
 * than an env var, so it works on Windows as well as POSIX — `import-content.ts`
 * sidesteps the same problem by reading the JSON itself, which is why that
 * script cannot see a Postgres-backed store and this one can.
 */
import { contentStore, describeContentStore } from "../lib/contentStore";

/** Routes that exist as files rather than as content. */
const STATIC_ROUTES = new Set([
  "/",
  "/bag",
  "/wishlist",
  "/products",
  "/collections",
  "/search",
  "/account",
  "/checkout",
]);

/** `app/(policies)/[slug]` — the four are the ids in `data/policies.ts`. */
const POLICY_ROUTES = new Set(["/privacy", "/returns", "/shipping", "/terms"]);

/** Synthetic collections in `lib/catalogue.ts` that are not categories. */
const COLLECTION_VIEWS = new Set(["all", "new", "sale"]);

interface Found {
  href: string;
  /** Where in the document it came from, so a failure is actionable. */
  at: string;
}

/**
 * Walks the content for anything shaped like a link.
 *
 * Keyed on the property name rather than on "any string starting with /",
 * because product image `src` values also start with a slash and are not
 * navigable routes.
 */
function collectHrefs(node: unknown, path: string, out: Found[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectHrefs(child, `${path}[${i}]`, out));
    return;
  }
  if (!node || typeof node !== "object") return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "href" && typeof value === "string") {
      // External links are somebody else's to keep alive.
      if (value.startsWith("/")) out.push({ href: value, at: `${path}.${key}` });
    } else {
      collectHrefs(value, `${path}.${key}`, out);
    }
  }
}

/**
 * Whether this looks like an unattended build rather than somebody's laptop.
 *
 * The distinction decides what an absent database *means*. Locally it usually
 * means "I have not set one up", which is normal and fine. In a deploy context
 * it far more often means the variable is not scoped to *this* environment —
 * typically a Production-only database on a Preview build — which is the silent
 * pass this guard exists to stop. See the header for why it is not a
 * build-versus-runtime split.
 */
function isDeployContext(): boolean {
  return Boolean(process.env.VERCEL || process.env.CI);
}

const HR = "─".repeat(64);

async function main(): Promise<void> {
  const store = describeContentStore();

  /**
   * Read first, and never inside a catch that swallows. A Postgres store that
   * cannot be reached has to surface as a failure — the one thing this script
   * must never do is quietly examine something else instead.
   */
  let publishedAt: Date | null;
  try {
    publishedAt = await contentStore.publishedAt();
  } catch (error) {
    console.error(HR);
    console.error(`FAILED — the ${store.driver} content store could not be reached.`);
    console.error(`  location: ${store.location}`);
    console.error("");
    console.error("Nothing was checked. This is a failure rather than a skip: passing here");
    console.error("would report a green link check on content nobody read. DECISIONS §34.");
    console.error(HR);
    console.error(error);
    process.exitCode = 1;
    return;
  }

  /**
   * The seed is about to be validated instead of a published document. Whether
   * that is honest depends entirely on why.
   */
  const seedIsLive = publishedAt === null;
  if (seedIsLive && store.driver === "file" && !store.explicit && isDeployContext()) {
    console.error(HR);
    console.error("FAILED — no published content, and no database configured.");
    console.error(`  driver:    file (inferred — DATABASE_URL is not set here)`);
    console.error(`  looked in: ${store.location}`);
    console.error("");
    console.error("In a deploy context this almost always means DATABASE_URL is not scoped");
    console.error("to THIS environment. Vercel has no build-vs-runtime split to get half");
    console.error("right: the only axis is Production / Preview / Development, and a");
    console.error("variable scoped to an environment is there for both the build and the");
    console.error("runtime. What does happen is a Marketplace resource (Neon, for one) set");
    console.error("to Production only, which removes Preview access — so branch builds run");
    console.error("with no database at all.");
    console.error("");
    console.error("Left alone, this check would have validated the /data seed and passed");
    console.error("while the document actually served went unread. §31, §34.");
    console.error("");
    console.error("Fix one of these:");
    console.error("  - scope DATABASE_URL to this environment (Preview as well as");
    console.error("    Production, if this is a branch deploy); or");
    console.error("  - if this deployment genuinely has no database and serves the seed,");
    console.error("    say so explicitly with CONTENT_STORE_DRIVER=file.");
    console.error(HR);
    process.exitCode = 1;
    return;
  }

  const { homepage, collectionPage, products } = await contentStore.read();

  const categoryIds = new Set(homepage.categories.items.map((c) => c.id));
  const productIds = new Set(products.map((p) => p.id));

  const found: Found[] = [];
  collectHrefs(homepage, "homepage", found);
  collectHrefs(collectionPage, "collectionPage", found);
  collectHrefs(products, "products", found);

  const resolves = (href: string): boolean => {
    // Query and hash are routing noise for this purpose.
    const path = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
    if (STATIC_ROUTES.has(path) || POLICY_ROUTES.has(path)) return true;
    if (path.startsWith("/collections/")) {
      const slug = path.slice("/collections/".length);
      return categoryIds.has(slug) || COLLECTION_VIEWS.has(slug);
    }
    if (path.startsWith("/products/")) return productIds.has(path.slice("/products/".length));
    return false;
  };

  const dead = found.filter((f) => !resolves(f.href));
  const unique = new Set(found.map((f) => f.href));

  /**
   * Provenance is printed on every run, pass or fail. A green link check that
   * does not say what it read is a green link check you cannot act on — which
   * was the entire defect §34 fixed.
   */
  const read =
    publishedAt === null
      ? "the /data seed — nothing has been published, so the seed IS what gets served"
      : `the published document (published ${publishedAt.toISOString()})`;

  console.log(`Store:   ${store.driver}${store.explicit ? " (explicit)" : ""} — ${store.location}`);
  console.log(`Read:    ${read}`);
  console.log(`Checked: ${unique.size} distinct internal links`);

  if (dead.length === 0) {
    console.log("Result:  all resolve.");
    return;
  }

  console.error("");
  console.error(`${dead.length} dead link${dead.length === 1 ? "" : "s"}:`);
  for (const { href, at } of dead) console.error(`  ${href}\n    at ${at}`);
  console.error("");
  console.error(
    seedIsLive
      ? "These are in the /data seed. Fix them there — nothing has been published yet."
      : "These are in the PUBLISHED content. Editing /data will not fix them — " +
          "change them in /admin and publish, or they stay dead. DECISIONS §31.",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
