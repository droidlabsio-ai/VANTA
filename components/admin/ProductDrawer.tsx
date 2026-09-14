"use client";

import { useEffect, useState } from "react";
import type { Product } from "@/data/types";
import { useDraft } from "./AdminDraftProvider";
import { BackdropPicker } from "./BackdropPicker";
import { ImagePicker } from "./ImagePicker";
import { Button, Field, Select, TextArea, TextInput, Toggle } from "./ui";
import { CloseIcon } from "./AdminIcons";
import { formatINR } from "@/lib/format";
import { sizesFor, variantsOf } from "@/lib/variants";
// Sizes for a new product, and the rule that they are created at save and
// never rewritten, live in lib/ so they can be tested without the admin.
import { FALLBACK_SIZES, planSizes, withSizes } from "@/lib/productSizes";

/** Badge values currently in use. `badge` is a free-form string in the schema, so
 *  presets are a convenience — "Custom…" keeps the full range the type allows. */
const BADGE_PRESETS = ["NEW", "LOW STOCK"];
const NONE = "__none__";
const CUSTOM = "__custom__";

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const initialBadgeMode = (p: Product) => {
  if (!p.badge) return NONE;
  return BADGE_PRESETS.includes(p.badge) ? p.badge : CUSTOM;
};

/**
 * The caller mounts this with a `key` per product, so opening a different row
 * remounts the drawer and the initial state below picks up the new product.
 * That avoids syncing props into state with an effect.
 */
export function ProductDrawer({
  product,
  isNew,
  onSave,
  onDelete,
  onClose,
}: {
  product: Product;
  isNew: boolean;
  onSave: (p: Product) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  // The categories the editor can actually pick, straight from the draft — so
  // renaming or adding one on the Categories page shows up here immediately.
  const { content } = useDraft();
  const categories = content.categories.items;
  const [draft, setDraft] = useState<Product>(product);
  const [badgeMode, setBadgeMode] = useState<string>(() => initialBadgeMode(product));

  // Escape closes the drawer; body scroll is locked while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const patch = (p: Partial<Product>) => setDraft({ ...draft, ...p });

  // Sizes: what the product already has, or what saving would give it.
  const existingSizes = variantsOf(draft);
  const hasSizes = existingSizes.length > 0;
  const planned = hasSizes ? null : planSizes(draft);
  const shownSizes = hasSizes ? existingSizes : (planned?.variants ?? []);
  const categoryName =
    categories.find((c) => c.id === draft.categoryId)?.name ?? draft.categoryId;
  // A stored single fallback size on a category with no size set means the
  // fallback applied when the product was created; say so then too.
  const fallbackApplied = hasSizes
    ? existingSizes.length === 1 &&
      existingSizes[0].size === FALLBACK_SIZES[0] &&
      Boolean(draft.categoryId) &&
      sizesFor(draft.categoryId) === undefined
    : planned?.fallback === true;
  const createdWhen = isNew ? "when you add the product" : "when you save";
  const sizesHint = hasSizes
    ? fallbackApplied
      ? `${categoryName} has no size set defined, so this product has a single size. It stays as it is if you rename the product or change its category.`
      : "Set from the product's category when it was created. They stay as they are if you rename the product or change its category."
    : planned
      ? planned.fallback
        ? `${categoryName} has no size set defined, so this product will have a single size. Created ${createdWhen}.`
        : `From ${categoryName}. Created ${createdWhen}, with codes built from the product ID.`
      : undefined;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "Add product" : `Edit ${draft.name}`}
        className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[520px] flex-col bg-admin-bg shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-admin-border bg-admin-surface px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-admin-display text-base font-semibold text-admin-ink">
              {isNew ? "Add product" : draft.name}
            </h2>
            <p className="text-xs text-admin-muted">
              {isNew ? "New product" : formatINR(draft.price)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 rounded-lg p-2 text-admin-muted transition-colors hover:bg-admin-bg hover:text-admin-ink"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <Field label="Product name" htmlFor="p-name">
            <TextInput
              id="p-name"
              value={draft.name}
              onChange={(e) => {
                const name = e.target.value;
                // Only a new product's id follows its name, and only until it is
                // saved: sizes are created at save (`withSizes`) from the final
                // id, so a half-typed name never becomes a SKU. An existing
                // product's id never changes here, and neither do its sizes —
                // once a product has SKUs they are kept even when a rename means
                // they no longer read like its name. That mismatch is correct
                // (§41). Do not "fix" it by regenerating them.
                patch(
                  isNew
                    ? { name, id: slugify(name), href: `/products/${slugify(name)}` }
                    : { name },
                );
              }}
            />
          </Field>

          {/* Required: a product with no category never appears on any
              collection page, and publishing refuses one pointing at a
              category that doesn't exist. The options are the real category
              list, so an invalid value isn't expressible here. */}
          <Field
            label="Category"
            htmlFor="p-category"
            hint="Which collection page this product appears on."
          >
            <Select
              id="p-category"
              value={draft.categoryId}
              onChange={(e) => patch({ categoryId: e.target.value })}
            >
              <option value="" disabled>
                Choose a category…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          {/* Read-only. Sizes follow the category (§41) and there is no size
              editor: this shows what the product is, or will be, sold in, and
              says so plainly when the category had no sizes to give. */}
          <Field label="Sizes" note={hasSizes ? "Set" : "Auto"} hint={sizesHint}>
            {shownSizes.length > 0 ? (
              <ul aria-label="Sizes" className="flex flex-wrap gap-1.5">
                {shownSizes.map((v) => (
                  <li
                    key={v.sku}
                    className="rounded-lg border border-admin-border bg-admin-surface px-2.5 py-1 text-xs text-admin-ink"
                  >
                    <span className="font-semibold">{v.size}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-admin-muted">{v.sku}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-admin-border px-3 py-2 text-xs text-admin-muted">
                {draft.categoryId
                  ? "Name the product to see its sizes."
                  : "Choose a category to see this product's sizes."}
              </p>
            )}
          </Field>

          <Field
            label="Product ID"
            htmlFor="p-id"
            note="Auto"
            hint="Created automatically from the product name."
          >
            <TextInput id="p-id" value={draft.id} disabled />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Price (₹)" htmlFor="p-price">
              <TextInput
                id="p-price"
                type="number"
                min={0}
                value={draft.price}
                onChange={(e) => patch({ price: Number(e.target.value) })}
              />
            </Field>

            <Field
              label="Compare-at price (₹)"
              htmlFor="p-compare"
              hint="Optional. Shown struck through."
            >
              <TextInput
                id="p-compare"
                type="number"
                min={0}
                value={draft.compareAtPrice ?? ""}
                placeholder="—"
                onChange={(e) =>
                  patch({
                    compareAtPrice: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>

          {draft.compareAtPrice !== undefined && draft.compareAtPrice <= draft.price && (
            <p className="rounded-lg border border-admin-danger/25 bg-admin-danger/5 px-3 py-2 text-xs text-admin-danger">
              Compare-at price should be higher than the price, or the strike-through
              won&rsquo;t show on the site.
            </p>
          )}

          <Field label="Photo">
            <ImagePicker
              value={draft.image}
              onChange={(image) => patch({ image })}
              idPrefix="p-image"
              slot="product"
            />
          </Field>

          <Field
            label="Card backdrop"
            hint="The colour panel behind this product's photo on the homepage."
          >
            <BackdropPicker
              value={draft.backdrop}
              onChange={(backdrop) => patch({ backdrop })}
              idPrefix="p-backdrop"
            />
          </Field>

          <Field label="Corner badge" htmlFor="p-badge">
            <Select
              id="p-badge"
              value={badgeMode}
              onChange={(e) => {
                const mode = e.target.value;
                setBadgeMode(mode);
                if (mode === NONE) patch({ badge: undefined });
                else if (mode === CUSTOM) patch({ badge: draft.badge ?? "" });
                else patch({ badge: mode });
              }}
            >
              <option value={NONE}>No badge</option>
              {BADGE_PRESETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              <option value={CUSTOM}>Custom…</option>
            </Select>
          </Field>

          {badgeMode === CUSTOM && (
            <Field
              label="Custom badge text"
              htmlFor="p-badge-custom"
              hint="Keep it short — it sits in the corner of the card."
            >
              <TextInput
                id="p-badge-custom"
                value={draft.badge ?? ""}
                onChange={(e) => patch({ badge: e.target.value })}
                placeholder="e.g. LAST PAIR"
              />
            </Field>
          )}

          <Toggle
            checked={draft.codAvailable}
            onChange={(codAvailable) => patch({ codAvailable })}
            label="Cash on delivery"
            hint="Shows a 'COD Available' tag on the product card."
          />

          <Field
            label="Product link"
            htmlFor="p-href"
            note="Not yet active"
            hint="Individual product pages are coming soon, so this link won't open anything yet."
          >
            <TextInput
              id="p-href"
              value={draft.href}
              onChange={(e) => patch({ href: e.target.value })}
            />
          </Field>

          <Field label="Photo description (alt text)" htmlFor="p-alt" hint="For screen readers.">
            <TextArea
              id="p-alt"
              rows={2}
              value={draft.image.alt}
              onChange={(e) => patch({ image: { ...draft.image, alt: e.target.value } })}
            />
          </Field>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-admin-border bg-admin-surface px-5 py-4">
          {!isNew && onDelete && (
            <Button variant="danger" onClick={() => onDelete(draft.id)}>
              Delete
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!draft.name.trim() || !draft.id}
              onClick={() => onSave(withSizes(draft))}
            >
              {isNew ? "Add product" : "Save changes"}
            </Button>
          </div>
        </footer>
      </aside>
    </>
  );
}

export const blankProduct = (): Product => ({
  id: "",
  name: "",
  // Overwritten by the drawer's category field; a product with no category
  // would simply never appear on a collection page.
  categoryId: "",
  price: 0,
  image: {
    src: "/images/product-shell-jacket.webp",
    alt: "",
    width: 896,
    height: 1200,
  },
  backdrop: "red",
  href: "",
  codAvailable: true,
  // No sizes here, deliberately: a blank product has no id or category yet,
  // and a SKU built from an empty id would be stored. The drawer creates them
  // from the category when the product is first saved — see `withSizes`.
  variants: [],
});
