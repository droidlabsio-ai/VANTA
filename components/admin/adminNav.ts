import type { ComponentType, SVGProps } from "react";
import {
  CategoriesIcon,
  OverviewIcon,
  PagesIcon,
  PhotosIcon,
  ProductsIcon,
  SettingsIcon,
  ShieldIcon,
  ShipmentsIcon,
} from "./AdminIcons";

/**
 * One node of the sidebar tree.
 *
 * Recursive rather than a fixed two levels: "Pages" now holds a page, which
 * holds that page's sections, and the storefront has more pages coming. A
 * shape that only nests once would have to be widened again for each of them.
 */
export interface AdminNavItem {
  label: string;
  href: string;
  /** Only top-level rows carry an icon; depth is shown by indentation below. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  children?: AdminNavItem[];
  /** Rows not yet built are shown but disabled, so scope stays visible. */
  ready?: boolean;
}

/**
 * Sidebar structure.
 *
 * "Pages" mirrors the storefront's own routes, and each page's children mirror
 * the keys of that page's content — so the nav can never drift from what the
 * schema actually contains. The Homepage's children are the keys of
 * `HomepageContent` in `data/types.ts`, one editor each.
 */
export const adminNav: AdminNavItem[] = [
  { label: "Overview", href: "/admin", icon: OverviewIcon, ready: true },
  {
    label: "Pages",
    href: "/admin/pages",
    icon: PagesIcon,
    ready: true,
    children: [
      {
        label: "Homepage",
        href: "/admin/pages/homepage",
        ready: true,
        children: [
          { label: "Hero", href: "/admin/pages/homepage/hero", ready: true },
          { label: "Lookbook", href: "/admin/pages/homepage/lookbook", ready: true },
          {
            label: "Brand Statement",
            href: "/admin/pages/homepage/brand-statement",
            ready: true,
          },
          {
            label: "Product Rail",
            href: "/admin/pages/homepage/product-rail",
            ready: true,
          },
          { label: "Trust Strip", href: "/admin/pages/homepage/trust", ready: true },
          { label: "Navigation", href: "/admin/pages/homepage/navigation", ready: true },
          { label: "Footer", href: "/admin/pages/homepage/footer", ready: true },
        ],
      },
      { label: "Collection pages", href: "/admin/pages/collections", ready: true },
      /**
       * Listed rather than hidden so the shape of the work stays visible.
       * Product pages render from product data today and have no page-level
       * content of their own yet.
       */
      { label: "Product pages", href: "/admin/pages/products" },
    ],
  },
  { label: "Products", href: "/admin/products", icon: ProductsIcon, ready: true },
  { label: "Stock", href: "/admin/stock", icon: ProductsIcon, ready: true },
  { label: "Categories", href: "/admin/categories", icon: CategoriesIcon, ready: true },
  { label: "Photos & Images", href: "/admin/photos", icon: PhotosIcon, ready: true },
  { label: "Orders & Shipments", href: "/admin/orders", icon: ShipmentsIcon, ready: true },
  { label: "Security", href: "/admin/security", icon: ShieldIcon, ready: true },
  { label: "Settings", href: "/admin/settings", icon: SettingsIcon },
];
