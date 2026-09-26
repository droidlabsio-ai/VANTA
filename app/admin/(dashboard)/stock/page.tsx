import { contentStore } from "@/lib/contentStore";
import { hasDatabase } from "@/lib/db";
import { stockLevels } from "@/lib/stock";
import { variantsOf } from "@/lib/variants";
import { Button, Card, CardHeader, Pill } from "@/components/admin/ui";
import { saveStockAction } from "./actions";

/**
 * Stock, per size (§47).
 *
 * One card per published product, one box per size. The rule the whole shop
 * follows is spelled out on the page because it is the one thing an editor
 * must know: a blank box means "not counted — always available", 0 means sold
 * out. Orders take stock automatically the moment they are placed.
 *
 * Reads the *published* catalogue: a size that exists only in an unpublished
 * draft cannot be bought, so it has nothing to count yet.
 */
export const dynamic = "force-dynamic";

const LOW_STOCK = 3;

export default async function AdminStockPage() {
  if (!hasDatabase()) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Header />
        <Card>
          <p className="p-5 text-sm text-admin-muted">
            Stock needs a database. Without one every size is shown as available.
          </p>
        </Card>
      </div>
    );
  }

  const { products } = await contentStore.read();
  const levels = await stockLevels(products.flatMap((p) => variantsOf(p).map((v) => v.sku)));

  const soldOut = [...levels.values()].filter((q) => q <= 0).length;
  const low = [...levels.values()].filter((q) => q > 0 && q <= LOW_STOCK).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Header />

      <Card>
        <div className="flex flex-wrap gap-x-8 gap-y-2 p-5 text-sm text-admin-muted">
          <p>
            <strong className="text-admin-ink">Blank</strong> = not counted, always available.{" "}
            <strong className="text-admin-ink">0</strong> = sold out.
          </p>
          <p>
            {soldOut} sold out · {low} running low (≤ {LOW_STOCK})
          </p>
        </div>
      </Card>

      {products.length === 0 && (
        <Card>
          <p className="p-5 text-sm text-admin-muted">No published products yet.</p>
        </Card>
      )}

      {products.map((product) => {
        const variants = variantsOf(product);
        return (
          <Card key={product.id} as="section">
            <CardHeader
              title={product.name}
              hint={variants.length === 0 ? "This product has no sizes to count." : undefined}
            />
            {variants.length > 0 && (
              <form action={saveStockAction} className="p-5">
                <input type="hidden" name="productId" value={product.id} />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                  {variants.map((variant) => {
                    const quantity = levels.get(variant.sku);
                    return (
                      <label key={variant.sku} className="block">
                        <span className="flex items-center justify-between gap-2 text-xs font-semibold text-admin-ink">
                          {variant.size}
                          {quantity !== undefined && quantity <= 0 && <Pill tone="muted">Sold out</Pill>}
                          {quantity !== undefined && quantity > 0 && quantity <= LOW_STOCK && (
                            <Pill tone="accent">Low</Pill>
                          )}
                        </span>
                        <input
                          type="number"
                          name={`qty:${variant.sku}`}
                          min={0}
                          max={100000}
                          step={1}
                          inputMode="numeric"
                          placeholder="Not counted"
                          defaultValue={quantity === undefined ? "" : Math.max(0, quantity)}
                          className="mt-1 w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-ink placeholder:text-admin-subtle focus:border-admin-accent focus:outline-none"
                        />
                        <span className="mt-1 block truncate text-[11px] text-admin-subtle">
                          {variant.sku}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="submit" variant="primary">
                    Save stock
                  </Button>
                </div>
              </form>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="font-admin-display text-2xl font-bold tracking-tight text-admin-ink">Stock</h1>
      <p className="mt-1 text-sm text-admin-muted">
        How many of each size you have. Orders take from these counts automatically.
      </p>
    </header>
  );
}
