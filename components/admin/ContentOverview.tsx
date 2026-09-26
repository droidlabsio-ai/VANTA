"use client";

import Image from "next/image";
import Link from "next/link";
import { backdropClass } from "@/lib/backdrops";
import { useDraft } from "@/components/admin/AdminDraftProvider";
import { Button, Card, Pill } from "@/components/admin/ui";
import { ExternalIcon, ChevronIcon } from "@/components/admin/AdminIcons";
import { StaleBadgeNotice } from "@/components/admin/StaleBadgeNotice";

export function ContentOverview() {
  const { products, content, isDirty, dirtySections, lastEditedAt, publish, discard } = useDraft();
  const hero = content.hero;

  const stats = [
    { label: "Products", value: products.length, href: "/admin/products", ready: true },
    {
      label: "Categories",
      value: content.categories.items.length,
      href: "/admin/categories",
      ready: true,
    },
    {
      label: "Homepage sections",
      value: 7,
      href: "/admin/pages/homepage/hero",
      ready: true,
    },
  ];

  return (
    <section className="mx-auto max-w-6xl">
      <h2 className="mb-4 font-admin-display text-lg font-bold tracking-tight text-admin-ink">
        Site content
      </h2>

      {/* Only appears when something has actually gone stale. */}
      <div className="mb-6 empty:mb-0">
        <StaleBadgeNotice />
      </div>

      {/* Unsaved changes call-to-action */}
      {isDirty ? (
        <Card className="mb-6 border-admin-accent/30 bg-admin-accent-soft">
          <div className="flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-1">
              <h2 className="font-admin-display text-sm font-semibold text-admin-ink">
                You have unpublished changes
              </h2>
              <p className="mt-0.5 text-sm text-admin-muted">
                Edited: {dirtySections.join(", ")}
                {lastEditedAt && ` · ${lastEditedAt.toLocaleTimeString()}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={discard}>Discard</Button>
              <Button variant="primary" onClick={publish}>
                Publish changes
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-1">
              <h2 className="font-admin-display text-sm font-semibold text-admin-ink">
                Everything is published
              </h2>
              <p className="mt-0.5 text-sm text-admin-muted">
                No pending edits. Pick a section below to make a change.
              </p>
            </div>
            <Link href="/admin/pages/homepage/hero">
              <Button variant="primary">Edit hero</Button>
            </Link>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        {/* Stats */}
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {stats.map((s) => (
              <Card key={s.label} className="p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-subtle">
                  {s.label}
                </p>
                <p className="mt-2 font-admin-display text-3xl font-bold text-admin-ink">
                  {s.value}
                </p>
                {s.ready ? (
                  <Link
                    href={s.href}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-admin-accent hover:underline"
                  >
                    Manage <ChevronIcon className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="mt-2 inline-block text-xs text-admin-subtle">
                    Editor coming soon
                  </span>
                )}
              </Card>
            ))}
          </div>

          <Card>
            <div className="border-b border-admin-border px-5 py-4">
              <h2 className="font-admin-display text-sm font-semibold tracking-tight text-admin-ink">
                Recent activity
              </h2>
            </div>
            <div className="px-5 py-4">
              {lastEditedAt ? (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-admin-ink">
                      {dirtySections.join(", ")} edited
                    </p>
                    <p className="text-xs text-admin-muted">
                      {lastEditedAt.toLocaleString()}
                    </p>
                  </div>
                  <Pill tone="accent">Unpublished</Pill>
                </div>
              ) : (
                <p className="text-sm text-admin-muted">
                  No edits yet in this session.
                </p>
              )}
              <p className="mt-3 border-t border-admin-border pt-3 text-xs text-admin-subtle">
                Activity is cleared when you reload this page.
              </p>
            </div>
          </Card>
        </div>

        {/* Live preview thumbnail */}
        <Card className="overflow-hidden">
          <div className="border-b border-admin-border px-5 py-4">
            <h2 className="font-admin-display text-sm font-semibold tracking-tight text-admin-ink">
              Homepage
            </h2>
            <p className="mt-0.5 text-xs text-admin-muted">Current hero</p>
          </div>

          <div className="p-4">
            <div className="overflow-hidden rounded-lg border border-admin-border bg-ink">
              <div className={`relative aspect-[4/5] w-full ${backdropClass[hero.backdrop]}`}>
                <Image
                  src={hero.image.src}
                  alt={hero.image.alt}
                  fill
                  sizes="320px"
                  className="object-cover object-top"
                />
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink via-ink/70 to-transparent" />
                <div className="headline absolute inset-x-0 bottom-0 p-4 text-xl leading-[0.9] text-bone">
                  {hero.headline.map((line, i) => (
                    <span key={i} className="block">
                      {line.map((seg, j) =>
                        seg.accent ? <em key={j}>{seg.text}</em> : <span key={j}>{seg.text}</span>,
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Link href="/admin/pages/homepage/hero" className="flex-1">
                <Button className="w-full">Edit hero</Button>
              </Link>
              <Link href="/" target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" aria-label="Open live site">
                  <ExternalIcon className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
