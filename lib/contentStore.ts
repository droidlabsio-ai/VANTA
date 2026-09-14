/**
 * Server-only. Importing this from a client component is a build error naming
 * this file, rather than a native module silently ending up in the browser
 * bundle — which fails as an unrelated "cannot read properties of undefined"
 * where the component is rendered. Client-safe constants live in
 * `lib/mediaLimits.ts`.
 */
import "server-only";

import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { homepage as seedHomepage } from "@/data/homepage";
import { collectionPage as seedCollectionPage } from "@/data/collectionPage";
import { products as seedProducts } from "@/data/products";
import { PrismaContentStore } from "@/lib/prismaContentStore";
import { withSizes } from "@/lib/productSizes";
import type { CollectionPageContent, HomepageContent, Product } from "@/data/types";

/**
 * The published site content, and the only thing either surface reads.
 *
 * `categories` is not a member: it lives inside `HomepageContent.categories`
 * already, and duplicating it here would give the same data two homes.
 */
export interface SiteContent {
  homepage: HomepageContent;
  /** Shared by every collection page and the collections index. */
  collectionPage: CollectionPageContent;
  products: Product[];
}

/**
 * Storage seam. Everything upstream depends on this interface and nothing else,
 * so moving to Postgres/Redis/a CMS means writing one more adapter — no route,
 * component or editor changes.
 */
/** An in-progress draft, plus when it was last saved. */
export interface DraftRecord {
  content: SiteContent;
  savedAt: string;
}

export interface ContentStore {
  read(): Promise<SiteContent>;
  write(next: SiteContent): Promise<void>;

  /**
   * When the published content was last written, or null if it never has been.
   *
   * Exists for `app/sitemap.ts`. A sitemap that stamps `new Date()` on every
   * entry tells a crawler "everything changed just now" on every fetch, which
   * is indistinguishable from telling it nothing — it is the reason
   * `lastModified` gets ignored. This is the real timestamp: the moment an
   * editor last pressed Publish, which is genuinely when every
   * content-derived page last changed.
   *
   * Null rather than a guess when nothing has been published. The sitemap then
   * omits `lastModified` for those entries, which is honest.
   */
  publishedAt(): Promise<Date | null>;

  /**
   * The unpublished draft, or null when there isn't one.
   *
   * Kept in a separate document from the published content rather than as a
   * flag on it. Published content is what the storefront reads on every
   * request; a draft must not be able to affect it even briefly, and keeping
   * them in one file makes that a matter of care rather than structure.
   */
  readDraft(): Promise<DraftRecord | null>;
  writeDraft(next: SiteContent): Promise<DraftRecord>;
  clearDraft(): Promise<void>;
}

/** The starting state: whatever `/data` currently holds. */
export function seedContent(): SiteContent {
  return structuredClone({
    homepage: seedHomepage,
    collectionPage: seedCollectionPage,
    products: seedProducts,
  });
}

/**
 * Fills in what a stored document predates.
 *
 * The store holds a document written by an earlier version of this code, so it
 * can be missing something the schema has since grown. Filling it here means the
 * schema can grow without a hand-run migration, and without the admin refusing
 * to load until someone performs one. Two things are filled:
 *
 * - **A whole top-level section**, taken from the seed — as when
 *   `collectionPage` was added (§20).
 * - **`variants` on a product that has none**, whether the key is missing or
 *   the list is empty (§42). Taken from the seed product with the same id,
 *   whose SKUs were generated once, checked and frozen (§41); for a product the
 *   seed does not know — one created in /admin later — derived from its
 *   category by `withSizes`, the rule a new product gets in the drawer.
 *
 * This used to promise that only whole missing keys are filled. It now reaches
 * into a product, so the guarantee is narrower, and it still holds: **nothing
 * that is present is replaced.** A section that exists is left as stored. A
 * product that already has sizes keeps them exactly — never regenerated, never
 * given new SKUs. No other field of any product is touched. The only field
 * written inside a product is one whose absence the strict schema rejects
 * outright, so what this fills is content that could not have been published
 * as it stood.
 *
 * Every read of both adapters, published and draft, goes through here, so the
 * next publish writes the filled-in document back and the stored copy stops
 * needing it.
 */
function withDefaults(stored: Partial<SiteContent>): SiteContent {
  const seed = seedContent();
  return {
    homepage: stored.homepage ?? seed.homepage,
    collectionPage: stored.collectionPage ?? seed.collectionPage,
    products: stored.products ? backfillVariants(stored.products, seed.products) : seed.products,
  };
}

/**
 * Gives sizes to stored products that have none, and leaves every other
 * product — and every other field — exactly as it was. See `withDefaults`.
 *
 * Synchronous and free of I/O on purpose: it runs on every read, and nothing
 * here may reach for a database or the filesystem.
 */
function backfillVariants(stored: Product[], seedProducts: Product[]): Product[] {
  const seedById = new Map(seedProducts.map((p) => [p.id, p]));
  return stored.map((product) => {
    // A stored document can predate the field entirely, whatever the type says.
    const variants = (product as Partial<Product>).variants;
    if (Array.isArray(variants) && variants.length > 0) return product;

    const fromSeed = seedById.get(product.id);
    if (fromSeed && fromSeed.variants.length > 0) {
      return { ...product, variants: fromSeed.variants };
    }

    // Not in the seed: the same rule a new product is saved with. With no id or
    // no category there is nothing to build from, and the product is returned
    // as stored rather than gaining an empty list it did not have.
    const derived = withSizes({ ...product, variants: [] });
    return derived.variants.length > 0 ? derived : product;
  });
}

/**
 * FILE ADAPTER — writes one JSON document next to the project.
 *
 * Chosen because it needs no external service and the whole payload is a few
 * kilobytes. It requires a writable disk, so it works in development and on a
 * normal server or container, but NOT on a read-only serverless filesystem
 * such as Vercel's. Swapping adapters is the intended migration path.
 *
 * Writes go to a temp file and are then renamed. `rename` is atomic on a single
 * filesystem, so a crash mid-write can never leave a half-written document
 * behind — a reader sees either the old file or the new one.
 */
class FileContentStore implements ContentStore {
  constructor(
    private readonly file: string,
    private readonly draftFile: string,
  ) {}

  /** Temp-file-then-rename, so a crash can't leave a truncated document. */
  private async atomicWrite(target: string, body: string): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, body, "utf8");
    await rename(tmp, target);
  }

  /** The document's mtime. `rename` updates it, so it is the publish time. */
  async publishedAt(): Promise<Date | null> {
    try {
      return (await stat(this.file)).mtime;
    } catch {
      // Never published: `/data` is the state, and it has no timestamp of its
      // own that means anything to a crawler.
      return null;
    }
  }

  async read(): Promise<SiteContent> {
    /**
     * Retried, with a short backoff, on a parse failure.
     *
     * A truncated read parses as a SyntaxError, and one bad read would 500
     * every storefront page at once. Writes are temp-file-then-rename, and
     * rename is atomic, so a reader should never see a partial document — this
     * is insurance against the case where that reasoning is wrong, not a fix
     * for an observed fault.
     *
     * Worth recording, because it was originally added for the wrong reason:
     * "Unexpected end of JSON input" appears on `next dev` when several routes
     * compile at once on a cold start, and it looked exactly like a torn read
     * of this file. It is not. Instrumenting every read showed all 33 of them
     * returning the full document while a page still 500'd, and the same
     * concurrent requests against a production build never fail. It is
     * Turbopack parsing its own dev manifests, and nothing here can fix it.
     *
     * Bounded, not a loop: a genuinely corrupt file must still surface rather
     * than be masked by retrying forever. It does not fall back to the seed —
     * that would serve the original copy and prices as though nothing had ever
     * been published.
     */
    const RETRY_DELAYS_MS = [25, 75];

    for (let attempt = 0; ; attempt++) {
      try {
        const raw = await readFile(this.file, "utf8");
        return withDefaults(JSON.parse(raw) as Partial<SiteContent>);
      } catch (error) {
        // First run: nothing written yet, so `/data` is the published state.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return seedContent();
        if (attempt < RETRY_DELAYS_MS.length && error instanceof SyntaxError) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        throw error;
      }
    }
  }

  async write(next: SiteContent): Promise<void> {
    await this.atomicWrite(this.file, JSON.stringify(next, null, 2));
  }

  async readDraft(): Promise<DraftRecord | null> {
    try {
      const record = JSON.parse(await readFile(this.draftFile, "utf8")) as DraftRecord;
      return { ...record, content: withDefaults(record.content) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      // A corrupt draft must not lock the admin out. Published content is
      // intact either way, so the safe move is to behave as if there is no
      // draft rather than to throw on every page load.
      return null;
    }
  }

  async writeDraft(next: SiteContent): Promise<DraftRecord> {
    const record: DraftRecord = { content: next, savedAt: new Date().toISOString() };
    await this.atomicWrite(this.draftFile, JSON.stringify(record, null, 2));
    return record;
  }

  async clearDraft(): Promise<void> {
    try {
      await unlink(this.draftFile);
    } catch (error) {
      // Already gone is the desired end state, not a failure.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/**
 * Kept outside `/data` so it is never confused with the seed modules, and
 * outside `/public` so it is never served. Override with CONTENT_STORE_PATH.
 */
const STORE_PATH =
  process.env.CONTENT_STORE_PATH ?? path.join(process.cwd(), ".content", "site.json");

/** Sits beside the published document, never inside it. */
const DRAFT_PATH = path.join(path.dirname(STORE_PATH), "draft.json");

/**
 * Which adapter runs.
 *
 * Postgres as soon as there is a database, because the host that needs a
 * database is also the host without a writable disk — a project with
 * DATABASE_URL set and the file adapter still selected would work perfectly in
 * development and fail on its first publish in production, which is the worst
 * possible time to find out.
 *
 * `CONTENT_STORE_DRIVER` overrides the choice in both directions, for the case
 * where the database exists for accounts but the content should stay on disk.
 *
 * Switching drivers does not move anything: the two stores are separate
 * places. Run `npm run content:import` once to copy a published `.content`
 * document into Postgres, or the site falls back to the `/data` seed and looks
 * as though every edit was lost.
 */
function selectStore(): ContentStore {
  const driver =
    process.env.CONTENT_STORE_DRIVER ?? (process.env.DATABASE_URL ? "postgres" : "file");

  if (driver === "postgres") {
    return new PrismaContentStore(withDefaults, seedContent);
  }

  return new FileContentStore(STORE_PATH, DRAFT_PATH);
}

export const contentStore: ContentStore = selectStore();

export interface ContentStoreDescription {
  driver: "postgres" | "file";
  /** Where the content is read from, for a human reading a log line. */
  location: string;
  /**
   * True when `CONTENT_STORE_DRIVER` named the driver outright, rather than it
   * being inferred from the presence of `DATABASE_URL`.
   *
   * The difference matters to anything deciding whether a fallback was
   * *intended*. Inferred-file means "no database was configured, which may
   * simply mean it was not visible from this environment"; explicit-file means
   * somebody said so on purpose.
   */
  explicit: boolean;
}

/**
 * Which store `contentStore` actually resolved to, and why.
 *
 * Exists because `selectStore()` reads the environment at import time and then
 * says nothing about what it decided. That silence is fine for the app — the
 * storefront does not care which adapter it is talking to — and dangerous for
 * anything *verifying* content, which cares about very little else.
 *
 * `scripts/check-links.ts` is the caller: it needs to report what it read, and
 * to refuse to pass when it cannot show that it read the thing that will be
 * served. See §34.
 */
export function describeContentStore(): ContentStoreDescription {
  const explicit = Boolean(process.env.CONTENT_STORE_DRIVER);
  const driver =
    process.env.CONTENT_STORE_DRIVER ?? (process.env.DATABASE_URL ? "postgres" : "file");

  return driver === "postgres"
    ? { driver: "postgres", location: "Postgres (ContentDocument)", explicit }
    : { driver: "file", location: STORE_PATH, explicit };
}
