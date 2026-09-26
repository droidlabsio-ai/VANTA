"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { createPersistentStore } from "@/lib/persistentStore";
import { lineKey, type BagLine } from "@/lib/bagLine";

/**
 * The bag.
 *
 * A line stores a product id, the size's SKU (§47) and a quantity — never a name, price or image.
 * Prices change, products get renamed, photographs get replaced. A bag that
 * stored those would keep showing whatever they were on the day it was added,
 * and would quietly bill from a stale number. Everything else is resolved
 * against the live catalogue when the bag is rendered.
 *
 * Browser-local, always. Signing in does not move the bag to the server: it
 * adds a second copy there, reconciled once at sign-in and mirrored on every
 * change after that (`components/AccountSync.tsx`). localStorage stays the
 * authority the UI reads, which is what keeps the bag instant, correct while
 * signed out, and unbothered by a slow or missing network.
 */
export type { BagLine } from "@/lib/bagLine";

/**
 * Every operation that targets one line takes its `lineKey` — product plus
 * size — because since §47 two sizes of one product are two lines.
 */
interface BagState {
  lines: BagLine[];
  /** Total number of items, not number of lines — what the badge shows. */
  count: number;
  /** Adds `qty` of a product in a size. A line for the same product and size grows instead. */
  add: (id: string, sku?: string, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  /**
   * Moves a line's quantity by `delta`, relative to what is currently stored.
   *
   * The +/− controls use this rather than `setQty(qty - 1)`. An absolute value
   * has to come from the last render, so two clicks landing in the same tick
   * both compute from the same stale number and the second one does nothing.
   */
  changeQty: (key: string, delta: number) => void;
  /**
   * Gives a line a size — for lines added before sizes were carried (§47).
   * If the bag already holds that size, the two lines merge.
   */
  setSize: (key: string, sku: string) => void;
  remove: (key: string) => void;
  clear: () => void;
  /**
   * Drops lines whose product id is not in `validIds`, and reports how many went.
   *
   * The bag stores ids; only a page holding the catalogue can say which of
   * them still exist. This is how that page tells the store.
   */
  pruneTo: (validIds: Set<string>) => void;
  /** How many lines the last prune removed. Zero once nothing is stale. */
  droppedCount: number;
  /**
   * False until the stored bag has been read.
   *
   * The server cannot see localStorage, so the first render must match what
   * the server produced or React replaces the markup and logs a hydration
   * error. Consumers show nothing until this is true rather than flashing a
   * count of zero over the real one.
   */
  hydrated: boolean;
}

const BagContext = createContext<BagState | null>(null);

const STORAGE_KEY = "vanta_bag_v1";
const MAX_QTY = 99;

/**
 * Anything unreadable is treated as an empty bag rather than throwing.
 *
 * Reads bags from before §47 unchanged: a line with no `sku` stays a line with
 * no `sku`, and the bag asks for a size when it needs one. Lines that collapse
 * to the same key are merged, so a hand-edited or doubled entry cannot become
 * two rows that share a React key.
 */
function parseLines(raw: string | null): BagLine[] {
  try {
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const merged = new Map<string, BagLine>();
    for (const l of parsed) {
      if (typeof l !== "object" || l === null) continue;
      const { id, sku, qty } = l as Partial<BagLine>;
      if (typeof id !== "string" || !Number.isFinite(qty)) continue;
      const line: BagLine = {
        id,
        ...(typeof sku === "string" && sku ? { sku } : {}),
        qty: clampQty(qty as number),
      };
      if (line.qty <= 0) continue;
      const key = lineKey(line);
      const existing = merged.get(key);
      merged.set(key, existing ? { ...existing, qty: clampQty(existing.qty + line.qty) } : line);
    }
    return [...merged.values()];
  } catch {
    return [];
  }
}

const clampQty = (qty: number) => Math.max(0, Math.min(MAX_QTY, Math.floor(qty)));

/**
 * How many lines the last prune dropped.
 *
 * Module state rather than React state so it can be set by the prune itself
 * and read through the same subscription — no update inside an effect, and no
 * ref written during render. It resets naturally: once the stale lines are
 * gone, the next page load prunes nothing and reports zero.
 */
let dropped = 0;

/**
 * Exported so `components/AccountSync.tsx` can read and replace the bag from
 * outside React. The store is already the source of truth React subscribes to,
 * so a write from the sync is indistinguishable from a write from a button —
 * every mounted consumer re-renders through the same subscription.
 */
export const bagStore = createPersistentStore<BagLine[]>({
  key: STORAGE_KEY,
  empty: [],
  parse: parseLines,
});

const { subscribe, getSnapshot, getServerSnapshot, write } = bagStore;

export function BagProvider({ children }: { children: React.ReactNode }) {
  const lines = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  /** True only once the client is driving, so consumers can hold the badge. */
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const add = useCallback((id: string, sku?: string, qty = 1) => {
    const current = getSnapshot();
    const key = lineKey({ id, sku });
    const existing = current.find((l) => lineKey(l) === key);
    write(
      existing
        ? current.map((l) => (lineKey(l) === key ? { ...l, qty: clampQty(l.qty + qty) } : l))
        : [...current, { id, ...(sku ? { sku } : {}), qty: clampQty(qty) }],
    );
  }, []);

  const setQty = useCallback((key: string, qty: number) => {
    const next = clampQty(qty);
    const current = getSnapshot();
    // Zero means remove. A zero-quantity line would show an item in the bag
    // that is not in the bag.
    write(
      next === 0
        ? current.filter((l) => lineKey(l) !== key)
        : current.map((l) => (lineKey(l) === key ? { ...l, qty: next } : l)),
    );
  }, []);

  const changeQty = useCallback((key: string, delta: number) => {
    const current = getSnapshot();
    const line = current.find((l) => lineKey(l) === key);
    if (!line) return;
    const next = clampQty(line.qty + delta);
    write(
      next === 0
        ? current.filter((l) => lineKey(l) !== key)
        : current.map((l) => (lineKey(l) === key ? { ...l, qty: next } : l)),
    );
  }, []);

  const setSize = useCallback((key: string, sku: string) => {
    const current = getSnapshot();
    const line = current.find((l) => lineKey(l) === key);
    if (!line) return;
    const targetKey = lineKey({ id: line.id, sku });
    if (targetKey === key) return;
    const target = current.find((l) => lineKey(l) === targetKey);
    const rest = current.filter((l) => lineKey(l) !== key && lineKey(l) !== targetKey);
    const merged: BagLine = {
      id: line.id,
      sku,
      qty: clampQty(line.qty + (target?.qty ?? 0)),
    };
    // Keep the line where it was in the list, so the row does not jump.
    const at = current.findIndex((l) => lineKey(l) === key);
    rest.splice(Math.min(at, rest.length), 0, merged);
    write(rest);
  }, []);

  const remove = useCallback((key: string) => {
    write(getSnapshot().filter((l) => lineKey(l) !== key));
  }, []);

  const clear = useCallback(() => {
    dropped = 0;
    write([]);
  }, []);

  const pruneTo = useCallback((validIds: Set<string>) => {
    const current = getSnapshot();
    const kept = current.filter((l) => validIds.has(l.id));
    if (kept.length === current.length) return;
    dropped = current.length - kept.length;
    write(kept);
  }, []);

  const droppedCount = useSyncExternalStore(
    subscribe,
    () => dropped,
    () => 0,
  );

  const count = useMemo(() => lines.reduce((total, l) => total + l.qty, 0), [lines]);

  const value = useMemo(
    () => ({ lines, count, add, setQty, changeQty, setSize, remove, clear, hydrated, pruneTo, droppedCount }),
    [lines, count, add, setQty, changeQty, setSize, remove, clear, hydrated, pruneTo, droppedCount],
  );

  return <BagContext.Provider value={value}>{children}</BagContext.Provider>;
}

export function useBag(): BagState {
  const ctx = useContext(BagContext);
  if (!ctx) throw new Error("useBag must be used inside <BagProvider>");
  return ctx;
}
