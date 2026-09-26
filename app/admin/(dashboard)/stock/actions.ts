"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/adminSession";
import { recordAudit } from "@/lib/auditLog";
import { contentStore } from "@/lib/contentStore";
import { hasDatabase, prisma } from "@/lib/db";
import { variantsOf } from "@/lib/variants";

/**
 * Saving stock counts for one product's sizes (§47).
 *
 * Each size arrives as a field named `qty:<SKU>`:
 * - **blank** — stop tracking this size. Its row is deleted and it is always
 *   available, which is how every size starts.
 * - **a whole number from 0** — track it. 0 means sold out.
 *
 * Only SKUs the published catalogue actually has are accepted. The form is a
 * public POST like any Server Action, and `requireAdmin()` is what makes it an
 * admin one; the catalogue check keeps a typo'd or forged field from creating a
 * row nothing will ever read.
 */
const MAX_STOCK = 100_000;

export async function saveStockAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  if (!hasDatabase()) return;

  const productId = String(formData.get("productId") ?? "");
  const { products } = await contentStore.read();
  const product = products.find((p) => p.id === productId);
  if (!product) return;

  const changes: Record<string, number | null> = {};
  for (const variant of variantsOf(product)) {
    const raw = formData.get(`qty:${variant.sku}`);
    if (raw === null) continue;
    const text = String(raw).trim();
    if (text === "") {
      changes[variant.sku] = null;
      continue;
    }
    const quantity = Number(text);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_STOCK) continue;
    changes[variant.sku] = quantity;
  }

  const entries = Object.entries(changes);
  if (entries.length === 0) return;

  await prisma.$transaction(
    entries.map(([sku, quantity]) =>
      quantity === null
        ? prisma.stockLevel.deleteMany({ where: { sku } })
        : prisma.stockLevel.upsert({
            where: { sku },
            create: { sku, quantity },
            update: { quantity },
          }),
    ),
  );

  await recordAudit({
    actor: admin.username,
    action: "stock.updated",
    target: product.name,
    detail: changes,
  });

  revalidatePath("/admin/stock");
  revalidatePath(`/products/${product.id}`);
  revalidatePath("/bag");
}
