import "server-only";

import { prisma } from "@/lib/db";
import { lineKey } from "@/lib/bagLine";

/**
 * The signed-in bag and wishlist.
 *
 * The browser keeps its own copy in localStorage and always will — it is what
 * makes the bag work signed out, offline, and before any JavaScript has spoken
 * to the server. This module is the other half: the copy that survives a new
 * phone.
 *
 * The two are reconciled once per sign-in by `mergeCustomerData`, and the
 * server copy is overwritten by `saveCustomerData` on every change after that.
 */

export interface StoredBagLine {
  id: string;
  /** The chosen size's SKU (§47). Absent for a line with no size chosen yet. */
  sku?: string;
  qty: number;
}

export interface CustomerData {
  bag: StoredBagLine[];
  wishlist: string[];
}

/** Matches `MAX_QTY` in `components/BagProvider.tsx`. */
const MAX_QTY = 99;

/**
 * A cap on how much a single account can store.
 *
 * Both lists arrive from the browser, which means both are attacker-controlled.
 * Without a bound, one request could write a hundred thousand rows.
 */
const MAX_LINES = 200;

const clampQty = (qty: number): number =>
  Math.max(0, Math.min(MAX_QTY, Math.floor(Number.isFinite(qty) ? qty : 0)));

/**
 * Normalises whatever the client sent into something safe to store.
 *
 * Ids are not checked against the catalogue here. A bag holding an id that no
 * longer exists is already an expected state — the bag and wishlist pages
 * prune against the live catalogue when they render — and validating here
 * would mean this module needed the content store, which it otherwise does not.
 */
function normalise(data: Partial<CustomerData> | null | undefined): CustomerData {
  const bag = Array.isArray(data?.bag) ? data.bag : [];
  const wishlist = Array.isArray(data?.wishlist) ? data.wishlist : [];

  const seen = new Set<string>();
  const cleanBag: StoredBagLine[] = [];
  for (const line of bag) {
    const id = typeof line?.id === "string" ? line.id.slice(0, 128) : "";
    const sku = typeof line?.sku === "string" ? line.sku.trim().slice(0, 64) : "";
    const qty = clampQty(line?.qty as number);
    const clean: StoredBagLine = sku ? { id, sku, qty } : { id, qty };
    if (!id || qty === 0 || seen.has(lineKey(clean))) continue;
    seen.add(lineKey(clean));
    cleanBag.push(clean);
    if (cleanBag.length >= MAX_LINES) break;
  }

  const cleanWishlist = [
    ...new Set(
      wishlist
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .map((id) => id.slice(0, 128)),
    ),
  ].slice(0, MAX_LINES);

  return { bag: cleanBag, wishlist: cleanWishlist };
}

/** Reads the stored copy. Wishlist newest first, matching the client's order. */
export async function readCustomerData(customerId: string): Promise<CustomerData> {
  const [bagLines, wishlist] = await Promise.all([
    prisma.bagLine.findMany({
      where: { customerId },
      select: { productId: true, sku: true, qty: true },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.wishlistItem.findMany({
      where: { customerId },
      select: { productId: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    // "" is how the table stores "no size chosen" — it is part of the key, so
    // it cannot be null (§47).
    bag: bagLines.map((line) =>
      line.sku ? { id: line.productId, sku: line.sku, qty: line.qty } : { id: line.productId, qty: line.qty },
    ),
    wishlist: wishlist.map((item) => item.productId),
  };
}

/**
 * Replaces the stored copy with what the browser now holds.
 *
 * A wholesale replace rather than a diff. The client is the authority between
 * sign-ins — it is where the quantity controls are — and the whole payload is
 * a few hundred bytes, so computing a minimal patch would cost more than it
 * saves and would introduce a way for the two to disagree.
 *
 * `createdAt` on surviving wishlist rows is preserved by only deleting what
 * actually left; wiping and reinserting would reshuffle the list into "all
 * saved just now" on every change.
 *
 * The bag, keyed by product *and size* since §47, is wiped and rewritten in
 * the same transaction instead: its order is the order lines were added, which
 * `updatedAt` on a fresh insert preserves, and a "not in these (product, size)
 * pairs" delete has no tidy Prisma form.
 */
export async function saveCustomerData(
  customerId: string,
  incoming: Partial<CustomerData>,
): Promise<CustomerData> {
  const { bag, wishlist } = normalise(incoming);

  await prisma.$transaction([
    prisma.bagLine.deleteMany({ where: { customerId } }),
    ...bag.map((line) =>
      prisma.bagLine.create({
        data: { customerId, productId: line.id, sku: line.sku ?? "", qty: line.qty },
      }),
    ),
    prisma.wishlistItem.deleteMany({
      where: { customerId, productId: { notIn: wishlist } },
    }),
    ...wishlist.map((productId) =>
      prisma.wishlistItem.upsert({
        where: { customerId_productId: { customerId, productId } },
        create: { customerId, productId },
        update: {},
      }),
    ),
  ]);

  return { bag, wishlist };
}

/**
 * Folds the browser's list into the stored one, once, at sign-in.
 *
 * Pure, and separated from the database call below, because this rule is the
 * one place where getting it wrong costs a customer money — it deserves to be
 * testable without a Postgres instance standing by.
 *
 * The rule for a quantity clash is **the larger wins, never the sum**. Adding
 * them is the tempting choice and it is wrong: the common case is the same
 * person adding the same jacket on their laptop and then on their phone, and
 * that person wants one jacket, not two. Doubling someone's order because they
 * signed in is a mistake they might only notice after paying.
 *
 * The wishlist is a plain union — it is a set, so there is nothing to reconcile.
 */
export function mergeData(local: CustomerData, stored: CustomerData): CustomerData {
  // Keyed by product and size (§47): an M and an L of the same tee are two
  // lines, and the larger-wins rule applies to each separately.
  const byKey = new Map(stored.bag.map((line) => [lineKey(line), line]));
  for (const line of local.bag) {
    const key = lineKey(line);
    const existing = byKey.get(key);
    byKey.set(key, { ...line, qty: Math.max(existing?.qty ?? 0, line.qty) });
  }

  return {
    bag: [...byKey.values()].slice(0, MAX_LINES),
    // Local first: an item saved on this device just now should be at the top
    // of the list, which is where the client would have put it.
    wishlist: [...new Set([...local.wishlist, ...stored.wishlist])].slice(0, MAX_LINES),
  };
}

export async function mergeCustomerData(
  customerId: string,
  incoming: Partial<CustomerData>,
): Promise<CustomerData> {
  const merged = mergeData(normalise(incoming), await readCustomerData(customerId));
  return saveCustomerData(customerId, merged);
}
