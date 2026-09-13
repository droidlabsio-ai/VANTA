# VANTA — Architecture Decisions & Known Issues

Running record of choices that aren't obvious from the code, plus open items.
Newest sections appended at the bottom.

---

## 1. Content layer: `/data` is the single source of truth

**Decision.** Every piece of homepage content — headlines, copy, images, product
data, category data, nav links, footer links — lives in `/data` as typed objects.
Components receive it as props and render it. No component contains copy or image
paths.

**Why.** A future admin dashboard needs to read and write this content without a
rebuild and without touching the component layer. Keeping components purely
presentational means the dashboard only has to satisfy the types in
[`data/types.ts`](data/types.ts) — it can serve the same shape from a database or
CMS and nothing downstream changes.

**Consequences / rules when extending:**

- `data/types.ts` describes *content and intent only*. No JSX, no class names, no
  Tailwind tokens.
- Styling intent is expressed as a named union that a component maps to actual
  styling. `Backdrop` (`"red" | "orange" | "sunset" | "graphite"`) is the model:
  the data layer names a mood, [`lib/backdrops.ts`](lib/backdrops.ts) maps it to
  gradient classes. An editor picks "orange"; they never see a hex value.
- Headlines are structured data, not strings. A `HeadlineLine[]` is a list of
  lines, each a list of segments, where `accent: true` renders that segment in
  the italic serif. This is what makes the sans/serif mix editable — which words
  are italic is content, not markup. `components/ui/Headline.tsx` is the only
  place that knows how to render it.

## 2. One motion vocabulary in `lib/motion.ts`

**Decision.** All easings, durations, and variants are defined once in
[`lib/motion.ts`](lib/motion.ts) and imported. Components do not define inline
transitions with ad-hoc numbers.

**Why.** Consistency is what separates "premium" motion from "janky". Two
easing curves only: `ease.out` for entrances, `ease.inOut` for hovers and state
changes. Durations are `fast` / `base` / `slow` (150/250/400ms).

**Reduced motion** is handled at two layers, deliberately:

1. `<MotionConfig reducedMotion="user">` in `components/Providers.tsx` covers
   every Framer Motion animation in the tree, so no component needs its own
   check.
2. A `@media (prefers-reduced-motion: reduce)` block in `app/globals.css`
   collapses CSS transitions and `scroll-behavior`, which Framer doesn't own.

Note that Framer's `reducedMotion="user"` disables **transform** animations but
intentionally keeps **opacity** ones. That is the documented behaviour, not a
bug — see §7 for how this bit us during testing.

**Where motion is allowed to live is a separate rule — see §13.** Importing
from `lib/motion.ts` does not make a component client-side; only rendering a
`motion.*` element does.

## 3. Carousels: native CSS scroll-snap, JS is read-only

**Decision.** The mobile lookbook carousel and product rail scroll with native
CSS `scroll-snap` (`.snap-rail` / `.snap-item` in `globals.css`). JavaScript
never drives the scroll position during a swipe.

**Why.** Native scrolling gives real momentum and stays on the compositor —
genuine 60fps on mid-range Android, which matters for the target market. A
JS-animated carousel cannot match it.

`lib/useActiveSnap.ts` only *observes* scroll position (rAF-throttled, passive
listener) to light up the correct dot indicator. Its `scrollTo` is used solely
when a user taps a dot, and it honours `prefers-reduced-motion` by falling back
to `behavior: "auto"`.

**One DOM tree serves both breakpoints.** The rail becomes a grid at `lg` via
`lg:grid lg:overflow-visible` rather than rendering separate mobile and desktop
markup. Less duplication, and no risk of the two drifting apart.

## 4. Desktop product grid uses `auto-fit`

**Decision.** The desktop product grid is
`lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]`, not a fixed column count.

**Why.** The rail's contents are data-driven, so the count can change from the
admin layer. A hard-coded `grid-cols-4` orphans the 5th card on its own row.
`auto-fit` keeps any count balanced on one row until it genuinely runs out of
width.

**Trade-off.** The column count is therefore a function of viewport width, not a
fixed design decision — at 1440px with 5 products it resolves to 5 columns. If a
future design requires exactly N columns regardless of count, this needs
revisiting.

## 5. Hover-scale is gated behind `motion-safe`

Product and lookbook images scale 1.0 → 1.05 on hover via
`motion-safe:group-hover:scale-105`. The `motion-safe` prefix matters beyond
accessibility: on touch devices `:hover` can stick after a tap, leaving a card
permanently zoomed. Verified to scale to exactly `matrix(1.05, …)` on pointer
enter and revert on leave.

## 6. Next.js 16 upgrade (from 14)

`npx @next/codemod@latest upgrade latest` upgraded dependencies but **halted at
an interactive prompt** ("Is your app deployed to Vercel?") before running any
source-level codemod. Each was verified manually instead; the project uses no
async request APIs (`params`, `searchParams`, `cookies()`, `headers()`) and no
middleware, so all were no-ops except the lint migration.

Four manual fixes were required:

| Issue | Fix |
|---|---|
| The codemod installed `eslint@10`, but `eslint-config-next@16.3.1` bundles `eslint-plugin-react@7.37.5`, which peers at `eslint ^9.7` and crashes on ESLint 10's rule-context API | **Pinned ESLint to 9.** `eslint-config-next` declares a too-loose `eslint: >=9.0.0`. Revisit when it ships an ESLint 10-compatible `eslint-plugin-react`. |
| React 19 removed the global `JSX` namespace | `JSX.Element` → `React.JSX.Element` in `components/ui/Icons.tsx` |
| `motion(Component)` deprecated in Framer Motion 11 | `motion.create(Link)` in `components/ui/PillButton.tsx` |
| Mobile menu sheet was `z-40` under a `z-50` header, making its close button unclickable | Sheet raised to `z-[60]`. Pre-existing bug, not an upgrade regression. |

`next lint` was replaced by the ESLint CLI with a flat config
(`eslint.config.mjs`); the legacy `.eslintrc.json` was deleted. Turbopack is the
default bundler in 16 and both `next dev` and `next build` run clean on it.
~~`npm audit` reports **0 vulnerabilities** (down from 5 high on Next 14).~~
That was true of this section's own upgrade, and stopped being true when §24
added Prisma. It now reports **4 high**, all in the `prisma` CLI's
dev-dependency chain: `deepmerge-ts` (stack exhaustion) and `mysql2` (auth
plugin downgrade, zlib decompression bomb), both reached through
`@prisma/config`.

**Deliberately not fixed.** None of it ships — `prisma` is a devDependency, and
nothing in that chain reaches the browser bundle or the serverless runtime;
`mysql2` in particular is a driver for a database this project does not use.
The only remedy npm offers is `--force` down to `prisma@6`, a breaking major
downgrade of the ORM the entire data layer is built on, to patch code that never
runs in production. Re-check when Prisma 7 ships a release that bumps them.

## 7. How this project gets visually verified

The in-app Browser pane is not displaying in this environment, so the page never
composites frames — `requestAnimationFrame` never fires and scroll events never
dispatch. Any animation or scroll assertion made through it silently reports a
false negative, and screenshots time out.

Verification is therefore done by driving the locally installed Chrome over CDP
with `puppeteer-core`, **installed in a scratchpad directory outside this repo**
so it never becomes a project dependency.

Two traps worth remembering:

- **Headless Chrome defaults `prefers-reduced-motion` to `reduce`.** Combined
  with §2, this makes transform animations silently absent while opacity still
  animates — which looks exactly like a broken reveal. Always call
  `page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }])`
  when testing normal motion.
- **Synthetic `MouseEvent`s do not activate CSS `:hover`.** Use `page.hover()`,
  which dispatches a real CDP pointer move.

## 8. Category rows: one mechanism for hover *and* tap

**Decision.** The thumbnail crossfade behind a category row is driven by Framer
variant propagation on the row link — `whileHover` / `whileFocus` / `whileTap`
all resolve to the same `active` variant, and the backdrop, label offset, and
arrow offset are children that read it.

**Why.** The brief asked for reveal on hover (desktop) *and* tap (mobile).
Tracking pointer type manually means two code paths that drift. One variant
name covers mouse, keyboard focus, and touch, and it crossfades over
`duration.slow` with `ease.inOut` rather than hard-swapping. Verified 0 → 0.38 →
0 on pointer enter/leave.

Labels are `whitespace-nowrap` so they never wrap — the Stitch reference broke
"JACKETS" across two lines, which we explicitly avoid.

## 9. Bottom nav hides at `md`, mobile menu at `lg`

**Decision.** The sticky bottom nav is `md:hidden` (gone from 768px up), while
the navbar switches from hamburger to full links at `lg` (1024px). Tablets
between 768–1023px therefore get the hamburger menu but no bottom bar.

**Why.** A bottom tab bar is a phone idiom; on a tablet it reads as a mistake.
The nav-link switch is driven by available horizontal space, which is a
different question. `body`'s reserved bottom padding in `globals.css` uses the
same `md` breakpoint, so the footer never gains a dead gap.

The active indicator uses a Framer `layoutId`, so it slides between items rather
than popping — free once routes exist, and inert today since only `/` matches.

## 10. Contrast is measured, not eyeballed

The palette leans on opacity over near-black, which makes it easy to drift below
legibility thresholds by accident. Measured effective contrast (composited
opacity over `#0D0D0D`):

| Element | Effective | Ratio |
|---|---|---|
| Product name / price, trust title, active dot | `245,245,240` | 17.8:1 |
| Hero description | `175,175,172` | 8.9:1 |
| Carousel caption, View All | `152,152,149` | 6.7:1 |
| Eyebrow, COD tag, trust detail | `129,129,127` | ~5.0:1 |
| Inactive carousel dot | `117,117,115` | **4.3:1** |

The inactive dot originally sat at `opacity: 0.3` → **2.51:1**, below the 3:1
WCAG 1.4.11 minimum for non-text indicators. Raised to `0.45`. **Any new muted
token below ~40% opacity on `#0D0D0D` should be measured before shipping.**

## 11. Accessible names: `sr-only` text, not `aria-label`, when there's a visible label

**Decision.** Where an element has visible text (the bottom nav's "Bag"), the
count is appended with a `.sr-only` span. Where it has none (the navbar's
icon-only bag), `aria-label` is used and the numeric badge is `aria-hidden`.

**Why.** WCAG 2.5.3 *Label in Name* requires the accessible name to contain the
visible text. `aria-label="Bag, 2 items"` **replaces** the name, and the
element's visible text is "2Bag" (label + badge), which isn't contained in it —
so the element fails. Lighthouse's `label-content-name-mismatch` caught this and
scores it **weight 0**, so the Accessibility category still read 100 while the
audit was failing. Don't trust the category score alone for this.

Note that marking the badge `aria-hidden` is *not* sufficient on its own — axe
still counts an `aria-hidden` element's rendered text as visible text. The
`sr-only` span is what actually fixes it.

Two implementation traps, both hit in practice:

- Put the appended text in **one template string**, not split JSX expressions.
  Chrome's name computation drops whitespace between sibling text nodes, giving
  "2ITEMS".
- Add `normal-case`, or the parent's `uppercase` leaks into the announced name.

The result is `"BAG , 2 items"` — the stray space before the comma is an
artifact of Chrome concatenating separate text nodes and isn't worth chasing;
the audit passes and the announcement is clear.

## 12. Images are WebP at rest; originals live outside `/public`

**Decision.** `/public/images` holds only WebP (sharp, quality 82, native
dimensions). The source PNGs are kept in **`/assets-src/images`**, which is
outside `/public` so it is never served.

**Why.** Next's optimiser was already transcoding to WebP on the fly, so this
changed delivered bytes only modestly (182 KB → 158 KB). The real wins are at
rest — **6.39 MB → 0.23 MB** of served assets — plus no per-image transcode on
first request. Native dimensions were kept because they already match the
largest rendered size (the hero is ~848px at 2x on a 412px viewport); Next
still resizes down per breakpoint from there.

When adding imagery: convert to WebP first, drop the original in
`/assets-src/images`, and reference the `.webp` from `/data`.

## 13. Animate the leaf, not the section

**Rule.** A section shell is a server component. Only the elements that actually
animate are client components, and they are the smallest possible wrappers
around server-rendered children.

Every section originally carried `"use client"` because it rendered a
`motion.*` element somewhere inside. That made the whole homepage a client tree.
The fix is to pass server-rendered markup as `children` into small client
wrappers, which React allows: a client component may render server-rendered
children when a server parent creates them.

**Current split:**

| Server (shell) | Client (leaf) | Why it must be client |
|---|---|---|
| `Hero` | `hero/HeroHeadline`, `hero/HeroCopy` | Load-time reveal. **The hero `<img>` stays in the server shell — it's the LCP element, so nothing should have to hydrate before it paints.** |
| `Lookbook` | `LookbookRail` | Needs the rail ref + dot state (`useActiveSnap`) |
| `BrandStatement`, `ProductRail`, `TrustStrip`, `Footer` | `ui/Reveal` wrappers only | Scroll-triggered reveal |
| `ProductCard` | — | Fully static; hover zoom is a CSS transition |
| `CategoryList` | `CategoryRow` | The row *is* the interaction (§8) |
| — | `Navbar`, `BottomNav`, `PillButton`, `Providers`, `BagProvider` | Inherently stateful/interactive |

**The primitives** in `components/ui/Reveal.tsx`:

- `Reveal` — standalone fade-up; declares its own scroll trigger.
- `RevealGroup` — owns the trigger and staggers descendants.
- `RevealItem` — **deliberately declares no `initial`/`whileInView`.** It
  inherits the group's state, which is what makes the stagger work. Give it its
  own trigger and every child animates at once.

Variants objects (`fadeUp`, `stagger(0.06)`) are plain serializable data, so a
server component can pass them across the boundary as props. Function props
cannot cross — that's why `Headline`'s `renderLine` callback is only used inside
the already-client `HeroHeadline`.

**What this did and didn't buy.** Behaviour is byte-identical and every QA check
matches. But **client JS barely moved: 183.0 KB → 181.1 KB.** Making a section a
server component removes its own code from the bundle, not a shared library its
leaves still import — and Framer Motion is the bulk of that bundle. LCP and
Performance stayed inside the noise band. Do this refactor for the architecture
and the hydration profile; don't expect it to move bytes on its own.

## 14. Admin dashboard: separate visual system, shared schema

`/admin` is a content manager for a non-technical shop employee. It lives in the
same Next.js app but is deliberately **a different visual system** from the
storefront: dark ink sidebar, light workspace, one orange accent, Archivo for
headings only, Inter everywhere else.

**Tokens.** Admin colours live under an `admin.*` key in `tailwind.config.ts`
(`admin-bg`, `admin-surface`, `admin-border`, `admin-ink`, `admin-muted`,
`admin-accent`, …). Storefront tokens (`ink`, `bone`, `flare`) are untouched.
**Don't mix the two families** — an `admin-*` colour in storefront code (or the
reverse) means the boundary has leaked.

**Fonts.** Admin headings need Archivo 600/700, but the storefront deliberately
ships only weight 900 (§10 / README). Those cuts are declared in
`app/admin/fonts.ts` and the variable is applied on the admin layout's wrapper,
so the extra font files load on `/admin` routes only and never enter the
storefront's critical path.

**One storefront change was required.** The mobile bottom-nav spacer used to sit
on `body`, which meant `/admin` inherited a dead 64px gap. It moved to a
`.storefront-shell` class applied in `app/page.tsx`. Verified no regression:
the footer still clears the bottom nav.

**The schema is the contract.** Admin forms bind to the exact fields in
`data/types.ts` — no invented fields, no omitted ones. Where the product brief
disagreed with the schema, the schema won; the conflicts are listed in §15.

## 15. Admin data layer persists through a swappable store

> **The draft half of this section is superseded by §39.** Drafts are no longer
> in-memory: the interface below has since grown `readDraft()`, `writeDraft()`
> and `clearDraft()`, and an unpublished draft is a second document on the
> server. Everything here about the *published* document still holds.

Superseded the in-memory phase. `lib/contentStore.ts` defines the seam:

```ts
interface ContentStore { read(): Promise<SiteContent>; write(next: SiteContent): Promise<void>; }
```

**The interface shown above is no longer the whole seam — §39.** It has since
gained the three draft methods, plus `publishedAt()` from §32. The claim that
mattered has now survived being tested twice: adding Postgres (§24) needed no
route, component or editor change, and adding server-side drafts needed no
editor change either. Note the order, because it is easy to assume the reverse:
**drafts predate the Postgres adapter**, so `PrismaContentStore` implemented
`readDraft`/`writeDraft`/`clearDraft` from its first commit and there was never
a version of it that lacked them.

Both surfaces depend on that interface and nothing else. `app/page.tsx` awaits
`contentStore.read()`; the admin dashboard layout reads it once and hands the
result to `AdminDraftProvider` as its baseline. **Neither imports `/data` any
more** — those modules are the store's *seed*, returned on `ENOENT` so a fresh
checkout renders the original content, and ignored from the first publish
onward. Importing them downstream would resurrect the seed over live content.

The shipped adapter writes one JSON document. It needs a writable disk, so it
does not work on a read-only serverless filesystem (Vercel). That is a
deliberate trade for zero external dependencies at this stage; moving to
Postgres/Redis/a CMS means one more class behind the same interface.

Writes go to a temp file and are then `rename`d. Rename is atomic within a
filesystem, so a crash mid-write cannot leave a truncated document — a reader
sees the old file or the new one, never half of either.

### Two things the wiring got wrong first, and why they matter

**`/admin` prerendered as static.** `contentStore.read()` is an `fs` call, which
Next cannot detect as dynamic, so the first build baked the admin's content in
at build time. An editing tool showing stale data is worse than a slow one: the
next publish would write that stale draft back over newer content. The dashboard
layout now sets `export const dynamic = "force-dynamic"`. The storefront is the
opposite case and stays static deliberately — it is regenerated by
`revalidatePath("/")` when something is actually published.

**`discard()` reset to `/data`.** Harmless while nothing persisted; once publish
works, it silently reverts live content back to the seed. It now restores the
last published baseline, held in a ref.

> **Still true, and no longer the whole of it — superseded by §39.** The ref
> survives: `baseline.current` is what `discard()` resets local state to, for
> exactly the reason above. What this sentence predates is that the work also
> lives on the server now, so clearing React state alone would leave the saved
> draft behind and the next load would restore what was just discarded.
> `discard()` therefore also calls `discardDraft()`.

### Validation is not optional here

`app/admin/actions.ts` re-verifies the session rather than relying on
`middleware.ts`: middleware covers page navigations, and a Server Action is a
POST endpoint, not a navigation.

It then validates against `lib/contentSchema.ts`. **Being signed in makes a
request authenticated, not trustworthy** — the payload is JSON assembled in the
browser. An invalid `backdrop` reaches `backdropClass[...]` as `undefined` and
breaks the storefront, so validation is what stands between a typo'd client and
a broken homepage. Each schema is pinned with `satisfies z.ZodType<T>` against
the type it mirrors, so a change to `data/types.ts` that isn't reflected here
fails the build instead of silently passing bad data through.

Two rules are cross-field and live in `superRefine`: every id in
`productRail.productIds` must resolve to a real product, and product ids must be
unique.

`useDraft()`'s consumer contract is unchanged apart from two additions
(`isPublishing`, `publishError`) — no editor component was touched.

### Schema conflicts found while building the admin

| Brief said | Schema says | Resolution |
|---|---|---|
| "Hero and Brand Statement share the same field shape" | `BrandStatementContent` has an extra required `eyebrow: string`; `HeroContent` does not | One shared editor with an **optional** eyebrow field, shown only when the section defines one |
| Products table shows a "status badge" | `Product` has **no** status/published field — only `badge?: string` and `codAvailable: boolean` | Render the real `badge` value plus a COD indicator. **No `status` field invented.** |
| Product editor: name, price, compare-at, image, backdrop, badge, COD | `Product` also requires `id` and `href` | Both included — `href` editable, `id` derived from the name as a slug and shown read-only |
| Badge is a dropdown | `badge?: string` is free-form, not a union | Dropdown of the values in use (`NEW`, `LOW STOCK`, none) **plus a custom text option**, so the control doesn't narrow the type |
| "Image upload" | `ImageAsset` requires `src`, `alt`, `width`, `height` | Picker also captures `alt` (required for a11y); `width`/`height` come from the chosen asset |
| Lookbook slide is "image, backdrop, caption" | `LookSlide` also has `id` and `href` | Both included — `href` editable and marked "Coming soon", `id` auto-derived |
| Product Rail "isn't new content, it's configuration" | `ProductRailContent` is `{ headline, viewAll, productIds }` — it **owns the section headline and the View All link** | Page edits all three. Products are still referenced by id only, never duplicated |
| Trust Strip has "4 fixed items" | `trust.items` is an **unbounded array**; `TrustItem` also has `id` | Add/remove supported. The *icon* picker is fixed, because `TrustIcon` genuinely is a closed union of four |
| WhatsApp support number belongs on Navigation | The WhatsApp link is in **`footer.links`**, not `NavContent` | Number field lives on the Footer page. Navigation links there instead of duplicating it |
| Navigation is "nav links (label + href)" | `NavContent` is `{ wordmark, links, bottomNav }` | Wordmark and the mobile bottom bar (with its own `BottomNavIcon` union) are edited too |
| Footer is "tagline, links list" | `FooterContent` also has `wordmark` and `copyright` | All four edited |
| Categories: "name, item count, thumbnail" | `Category` also has `id` and `href`; the section also has a `heading` | All included — `heading` edited above the table, `id` auto, `href` marked "Coming soon" |

## 15b. Image uploads

`ImagePicker` uploads real files. The pipeline is `processUpload` →
`mediaStore`, served back by `app/media/[id]/route.ts`.

**Uploads are stored outside `/public`.** `/public` is a curated, build-time
asset directory — WebP only, originals in `/assets-src`. Runtime-mutable
uploads mixed into it would blur that line, so they go under `.content/`
alongside the content store, and reach the browser through a route instead.

**Uploads are not draft state.** The file is written and live the moment it
succeeds, whether or not the surrounding section is published. The alternative —
holding bytes in the browser until publish — would mean a draft referencing an
image the server has never seen, and losing the upload on a refresh.

### An upload is hostile until decoded

The filename, the extension and the Content-Type header are all set by the
client, so none of them is evidence of anything. The only thing that establishes
a file is an image is a decoder accepting it. Every check runs against sharp's
reading of the bytes:

- **Re-encoded, always.** Decoding to pixels and writing a fresh WebP means
  nothing of the original container survives — no EXIF (phone photos carry GPS
  coordinates), no colour-profile payloads, no data appended after the image to
  make a polyglot file. What gets served is a file this process wrote.
  `rotate()` applies EXIF orientation *before* that metadata is dropped, or
  portrait phone photos come out sideways.
- **SVG is refused.** It is not a raster image but a document that can carry
  `<script>`; serving one from our own origin would be a stored-XSS primitive.
  GIF is refused too, for the duller reason that re-encoding to still WebP
  silently destroys the animation.
- **`limitInputPixels` is set.** A small, highly compressed file can decode to
  gigabytes. The file-size check cannot catch that — the danger is in the
  decoded size, not the encoded size.
- **Stored names are generated ids, never the client's filename.** The filename
  is sanitised only to be shown as a label. Nothing user-supplied reaches the
  filesystem.
- **The serving route builds no path from the request.** The id must match the
  generated-id pattern and then be present in the manifest; a path is only
  constructed from an id already known to be ours.

Verified against the real cases: EXIF-bearing JPEG comes out with no EXIF and no
trace of the probe string in the bytes; an SVG carrying `<script>` is rejected;
a text file named `.png` is rejected; `../../../etc/passwd.png` yields the label
"passwd"; and `/media/` returns 404 for unknown and malformed ids.

### What this is not

~~It is not a media library. There is no `/admin/photos` page — upload and
delete live inside the picker, and the sidebar entry stays marked "Soon".~~
**No longer true.** `/admin/photos` exists
(`app/admin/(dashboard)/photos/page.tsx`) and its nav entry is `ready: true`;
only Settings and Product pages are still marked "Soon". Upload and delete are
still available inside the picker as well. The paragraph below still holds and
is the part that matters: delete does
not check whether an image is still referenced by published content: that would
need a full content scan on every delete, and a reference can be added a moment
later anyway. The picker warns; a missing image degrades to a broken tile, not a
broken page.

## 16. Admin component map

| Component | Role |
|---|---|
| `AdminShell` / `AdminSidebar` | Chrome. Sidebar nav mirrors the keys of `HomepageContent`, so it can't drift from the schema. Unbuilt editors show a "Soon" chip rather than being hidden. |
| `AdminDraftProvider` | ~~In-memory draft state (§15)~~ **Superseded by §39** — still the live editing state, but the draft is autosaved to the server and restored on load. Durability moved; editing did not. |
| **`SectionEditor`** | **One editor for both Hero and Brand Statement** |
| `HeadlineEditor` | Edits `HeadlineLine[]` structurally |
| `BackdropPicker` | The four `Backdrop` values, rendered with the real gradients |
| `ImagePicker` | Picks from `mediaLibrary`, edits `alt` |
| `SectionPreview` | Live preview, desktop/mobile |
| `ProductDrawer` | Slide-in product form |

**The shared section editor.** `SectionEditor` takes `HeroContent |
BrandStatementContent` and narrows with an `"eyebrow" in value` type guard. The
eyebrow field renders only for the brand statement; everything else is shared.
Adding a third editorial section means passing it in, not forking the component.

**`HeadlineEditor` exposes the schema's real nesting** — lines containing
segments — rather than flattening it to a string with markup. Add/remove lines,
add/remove segments, toggle accent per segment. Segment inputs render in the
italic serif when accented, so the control previews itself. **Spacing lives in
the segment text** (`"MADE "` has a trailing space), so inputs never trim, and
the helper text says so.

**Two deliberate approximations, both labelled in the UI:**

- `SectionPreview` is *not* the real `Hero`/`BrandStatement`. Those are server
  components and can't be imported into a client tree, so the preview rebuilds
  their layout from the same tokens and `backdropClass` gradients. Good for
  judging copy, image and backdrop; not for pixel sign-off.
- `mediaLibrary` is a hardcoded list of what's in `/public/images`. Real upload
  needs a storage target plus the WebP conversion step in the README, which is
  out of scope for this phase.

**`ProductDrawer` is mounted with a `key`** (the product id, or `"new-product"`)
so opening a different row remounts it and `useState` initialisers pick up the
new product. This replaced a prop→state sync effect that `react-hooks/set-state-in-effect`
correctly flagged.

**The badge control is a preset/custom hybrid** because `badge?: string` is
free-form. A plain dropdown would silently narrow what the type allows, so
"Custom…" reveals a text input. Switching from a preset carries the old value
across as the starting point.

**The draft store holds the whole `HomepageContent` object**, not one field per
section. `updateSection(key, value)` is generic over `keyof HomepageContent`, so
adding an editor needs no provider change. Section labels for the dirty banner
come from one `SECTION_LABELS` map keyed by the same union.

**Deleting a product also removes it from the rail.** `productRail.productIds`
references products by id, so leaving a deleted id behind would produce a
dangling reference. `removeProduct` prunes both.

**Reordering uses up/down buttons, not drag-and-drop.** No extra dependency, it
works with a keyboard and screen reader without custom ARIA, and these lists are
3–7 items. Worth revisiting only if a list grows past ~15 rows.

**`LinkListEditor` is shared by Navigation and Footer** — both edit `Link[]`. It
exposes the optional `external` flag, which is what the WhatsApp link needs to
open in a new tab.

### No schema fields have been added for the admin

Worth stating plainly, because it's the thing most likely to drift: **the admin
has never added a field to `data/types.ts`.** Every control binds to something
that already existed.

The one that looks like an addition is the "Opens outside the site" toggle on
Navigation and Footer links. It is backed by `external?: boolean` on the shared
`Link` interface, which **pre-dates the admin entirely** — it was authored with
the content layer and is consumed by `components/Footer.tsx`, which adds
`target="_blank" rel="noopener noreferrer"` when set. `data/homepage.ts` has
used `external: true` on the WhatsApp link since the footer was built.

Note also that there is no `NavLink` or `FooterLink` type — `nav.links` and
`footer.links` are both `Link[]`, which is exactly why one `LinkListEditor`
serves both.

The toggle writes `external: true` or removes the key (never stores `false`),
matching the field's optionality.

### Verification note

The banned-phrase audit (`copy-audit.mjs`) is run **against a freshly started
production server**. An early run in this phase reported all pages "clean" while
an old server instance was still bound to the port — the new routes were 404ing,
so the audit was scanning error pages.

The script now refuses to be fooled. Before scanning any page it requires:

1. HTTP status exactly **200** (the navigation response is checked, not discarded)
2. the page is **not** Next's not-found page
3. the `<h1>` **matches the heading that route should render** — this catches a
   stale build that happens to return 200 with different content

Any failure marks the route `FAILED`, skips scanning it, and exits non-zero with
"AUDIT INVALID — do not treat this run as a pass". On table pages it also
asserts the edit drawer actually opened, so drawer copy can't be silently
skipped. Both guards were verified against a dead port and against a live
server serving a 404.

## 17. Admin authentication

Single admin user, no accounts system. Credentials live in environment
variables and are never committed — see `.env.local.example`.

**Three env vars are required** (the brief named two; the third is inherent to
signing a session rather than issuing a guessable token):

| Variable | Purpose |
|---|---|
| `ADMIN_USERNAME` | Sign-in username |
| `ADMIN_PASSWORD` | Sign-in password |
| `ADMIN_SESSION_SECRET` | HS256 key for the session JWT. **≥32 chars**; `lib/session.ts` throws on startup if it's missing or too short, rather than silently signing with a weak key. |

**Session.** On success the server issues a `jose` HS256 JWT (7-day expiry,
issuer + audience pinned) in a cookie that is `httpOnly`, `sameSite=lax`,
`path=/`, and `secure` in production. Verified in practice: `httpOnly: true`,
`sameSite: Lax`, `secure: true`, 7-day expiry, three-segment JWT.

**Password comparison is timing-safe.** `lib/credentials.ts` compares
**SHA-256 digests** with `crypto.timingSafeEqual`, not the raw strings.
Hashing first gives both sides a fixed 32 bytes — necessary because
`timingSafeEqual` throws on length mismatch, and that throw would itself leak
the length of the real secret. Username and password are both always compared,
so the work done doesn't depend on whether the username matched.

**Enforcement is in `middleware.ts`, not the UI.** A logged-out request to any
`/admin` route is redirected before any admin markup is generated, so nothing
flashes. Verified against five routes.

**Two modules, split by runtime.** `lib/session.ts` is `jose`-only with no
`node:` imports so it runs on the Edge runtime that middleware uses;
`lib/credentials.ts` imports `node:crypto` and must never be imported from
middleware.

**Route structure.** Dashboard pages moved under `app/admin/(dashboard)/`, which
owns the sidebar chrome. `/admin/login` sits outside that group, so it renders
without the shell and is exempt from the session check. The route group doesn't
change any URL. Signing in while already authenticated redirects to `/admin`.

**Error messages are deliberately generic.** One message covers every credential
failure and never indicates which field was wrong — distinguishing them would
confirm a valid username. A *different* message is shown when the server has no
credentials configured, since that's an operator problem, not a user error.

### Rate limiting — superseded by §25

This section used to record an in-memory `Map` as an interim measure that
"will not hold up in production", to be moved to a shared store once one
existed. **That has happened**: `lib/rateLimit.ts` is backed by Postgres, keyed
by IP and identifier separately, with exponential backoff. See §25.

Two things from the original caveat still stand and are worth keeping here:

- The client key comes from `x-forwarded-for` / `x-real-ip`, which is spoofable
  unless the deployment guarantees those headers are set by a trusted proxy. On
  Vercel they are; on any other host this needs checking. Moving the counter
  into a database did not make the identity behind it any more trustworthy.
- The session described above is superseded in one respect too: the token now
  carries a session id and can be revoked. §25.

## 18. Cinematic scroll — storefront only

The storefront is a scroll-driven editorial page: the scrollbar is the timeline.
GSAP ScrollTrigger drives the scenes, Lenis provides the momentum.

**Motion score** (the storyboard the build follows):

| Chapter | Scene |
|---|---|
| Hero | Pinned. Camera pulls back — photo settles and drifts up, copy lifts and fades, frame dims slightly as the story hands over. |
| Lookbook | Multi-depth parallax; alternating depths so the row reads with dimension rather than moving as one slab. |
| Brand statement | A slow camera move over a single portrait — small rotation only. |
| Product rail | Gentle lift, deliberately **no pin**: the eye needs to read prices here. |
| Trust strip | A quiet beat. Nothing moves. |
| Categories → footer | The environment has cooled to graphite; lights down. |

**Environment morph.** The homepage already encoded a journey in its backdrop
tokens (red studio → sunset → burnt orange → graphite). `EnvironmentMorph` lifts
that out of the photo panels and puts it behind the whole page as one continuous
low-opacity glow, scrubbed against document progress.

### Why it is NOT on `/admin`

The brief said "all the pages". The admin is deliberately excluded, and this is
a judgement call worth recording rather than a gap:

- Lenis hijacks the scroll position, which fights form focus, `scrollIntoView`,
  and the edit drawers' own scroll containers.
- Pinned chapters and scrubbed timelines in a data table or a settings form make
  the tool slower to use, not more impressive.
- It is an internal content manager, not a marketing surface — there is no story
  to tell with a camera.

`ScrollEngine` is therefore mounted by the storefront page, **never the root
layout**. Nothing under `/admin` imports gsap or lenis.

### Scenes wrap sections, they don't replace them

Each scene component takes server-rendered `children` and only animates them, so
§13 still holds: every section is a server component and the hero `<img>` is
still in the SSR HTML as the LCP element. The wrappers are client leaves.

**Every animated property starts at its natural CSS resting state.** That means
no `gsap.set()` on mount, and therefore no flash of an un-animated end-state
before JS runs — the classic tell of a bolted-on scroll library.

### Reduced motion

`ScrollEngine` never starts Lenis at all when `prefers-reduced-motion: reduce` —
scrolling stays entirely native. Each scene registers inside
`gsap.matchMedia("(prefers-reduced-motion: no-preference)")`, so reverting that
context restores the resting state. Verified: with reduce set, hero transform is
`none`, the environment colour never changes, no pin-spacer is created, and every
section is fully visible.

### Two things measurement caught that reading the code would not

1. **Dead air after the pin.** A 90% hold left ~350px of black between the hero
   releasing and the lookbook arriving. Measured the actual gap
   (pin-spacer bottom → first slide top), then shortened the hold to 55% desktop
   / 35% mobile so the next chapter is already arriving as the hero leaves.
2. **34px of horizontal overflow.** The 3D-rotated frame in the brand statement
   pushed its corners past the viewport edge. Fixed with `overflow-x: clip` on
   the tilt root — `clip` rather than `hidden` so no scroll container is created.

Mobile scales motion down rather than off: shorter pin, ~45% tilt, and
`syncTouch: false` so touch keeps the platform's own scrolling.

### Refinement pass — what was taken from reference sites, and what wasn't

Studied four scroll-driven sites (Lightweight, Moto Card, Otsuka /zeroz, Oryzo)
by driving them headlessly and sampling several scroll depths, rather than
reading about them.

**Taken, adapted:**

- **A chapter rail.** Lightweight runs a numbered section index down the left
  edge. Adapted rather than copied: their content column starts ~720px in, ours
  starts at a 64px gutter, so a labelled index *collided with the body copy and
  the CTA* on first build. Reduced to a tick rail at the far edge with only the
  active chapter named, set vertically — ~34px wide, verified zero collisions
  with any `main` text at 1440 and 1600.
- **Per-character headline reveal.** They use GSAP's SplitText; `lib/splitHeadline.ts`
  does the same job in our own code — no extra dependency, no licensed plugin —
  and keeps the accent (italic serif) flag attached per character.
- **Blueprint furniture.** Corner crosshairs, a measurement rule and a
  `FIG. 02 —` caption, borrowed from Lightweight's and Oryzo's technical marks.
  Pure server-rendered SVG at ~15–20% opacity: texture, not animation.

**Deliberately not taken:**

- **three.js / WebGPU** (Moto Card loads three + GLTFLoader across 3 canvases).
  There is no 3D asset here, and it would undo the LCP work in §13.
- **13–63 screens of scroll.** Otsuka runs ~49 screens with 25 sticky sections,
  Oryzo ~63. This is a shop, not a brand film — dead scroll between the hero and
  the products costs conversions. Ours stays at ~7 screens.

**Accessibility of the split text.** Splitting a headline into per-character
spans makes a screen reader announce it letter by letter. Each `RevealHeadline`
therefore exposes the real string once in an `sr-only` span and marks the split
markup `aria-hidden`. Verified: the accessible names are still
"OWN YOUR DIRECTION." and "BUILT FOR EVERY MOVE", and under reduced motion every
character renders fully visible and untransformed.

**The active chapter is computed, not triggered.** Giving each chapter its own
start/end ScrollTrigger produced overlapping ranges where whichever fired last
won — the rail read "04 The Kit" while Series 026 filled the screen. Replaced
with a single question asked against one line: which section contains the
viewport midpoint. Verified stepping cleanly 0→1→2→3→4 across the page.

---

## 19. Collection and product pages, and the first schema addition

`/collections/[slug]` and `/products/[slug]` exist, so the nav, the product
rail and the category rows lead somewhere. Both read the content store, not
`/data`, so a product edited in `/admin` appears on them.

### `Product.categoryId` — the first field added to `data/types.ts`

§16 recorded that the admin had never added a field to the schema. This is not
the admin: collection pages need to know what belongs in them, and there were
only two ways to express it. Listing product ids on each category (the way
`ProductRail` does) puts the relationship somewhere a product editor cannot
see, and it is the answer that stops scaling first. A product knowing its own
category is the one that stays right at a few hundred products.

Publishing now enforces that every `categoryId` resolves to a real category,
and the admin's product drawer picks from the live category list, so an
invalid value is not expressible through the UI either.

### Sale and New are views, not categories

`/collections/new` and `/collections/sale` are computed from the catalogue —
`badge === "NEW"`, and a `compareAtPrice` above `price`. Neither is a group a
product belongs to: "on sale" is a fact about a price, and asking an editor to
tag it as well would be asking them to keep two things in sync by hand.
`/collections/all` is the same idea with no filter.

### These pages are deliberately quiet

No pinned scenes, no camera moves, no environment morph. The cinematic layer is
the homepage's argument; a listing page is where someone compares garments and
reads prices, and scroll-hijacking works against that. They use `Reveal` only.

### Imagery is placeholder, and the alt text knows it

There are five photographs and 45 products, so shots repeat. Alt text describes
**the garment the entry is for**, not the photograph standing in for it — so
replacing a photo through `/admin` does not leave a false description behind.

Not sourced from anywhere: reference imagery was requested from Pinterest, and
those photographs belong to other brands and photographers. Real photography
goes in through the uploader.

### ~~`itemCount` is stored, not derived~~ — reversed by §30

This recorded `Category.itemCount` as a stored mirror of the product count,
"because the homepage rows render without loading the catalogue", and admitted
that "nothing enforces" keeping it current.

**Both halves were wrong.** `app/page.tsx` is a server component that already
reads the whole content store, products included, so the premise never held —
the field bought nothing. And "nothing enforces that yet" turned out to mean
every single value drifted: the homepage row read "TOPS — 38 ITEMS" over a page
listing 10. The field is gone; counts are derived. §30.

## 20. Collection pages are editable

Split in two, because "the collection page" is two different things.

**Per-collection** content lives on `Category`, as optional `description` and
`banner`. A collection page *is* a category — it already owns the name, href
and thumbnail — so editing happens where someone would look for it, on the
Categories page. Both optional: a collection page is complete without them and
falls back to its plain heading, so no copy has to be invented for eight
categories before any of them can be published.

**Template-level** content is a new `CollectionPageContent` on `SiteContent`,
edited at Pages → Collection pages: the index heading and intro, the
empty-state message and its link label, whether the piece count shows, and the
names of the three computed views. Keeping these on `Category` would mean
storing the same empty-state message once per category and keeping eight
copies in sync by hand.

The view names matter most: `/collections/new`, `/sale` and `/all` have no
`Category` behind them, so their titles were hardcoded in `lib/catalogue.ts`
with no way to change them. The admin explains what each one collects rather
than naming the mechanism — "Products marked NEW", not "badge === NEW".

### The store now fills in missing sections

`contentStore.read()` merges the seed for any absent top-level key. The stored
document is written by an earlier version of this code and can predate a
section the schema has since grown, exactly as it did here. Merging means the
schema can gain a section without a hand-run migration and without the admin
refusing to load until someone performs one. Only whole missing keys are
filled — anything present is left exactly as stored, so it can never quietly
overwrite published content.

### `read()` retries once on a parse failure

A read landing mid-write returns a truncated document, and one bad read would
500 every storefront page at once. Writes are temp-file-then-rename precisely
so that cannot happen, but it was observed twice under concurrent
first-requests in dev. One retry, not a loop: a genuinely corrupt file must
still surface. It does not fall back to the seed — that would serve the
original copy and prices as though nothing had ever been published.

### Debt: categories still live under `homepage`

`homepage.categories` is what the collection pages read, which is now plainly
the wrong home for it — it is site-wide data filed under one page. Moving it
touches the schema, the store, the homepage editor and validation, so it was
left alone rather than folded into an unrelated change. It gets harder the
longer it waits.

## 21. Bag and wishlist

Both store ids and nothing else, and both share `lib/persistentStore.ts`.

> **Superseded in one respect by §24.** This section originally opened "both are
> browser-local", full stop. `localStorage` is still the primary store and still
> the only one a signed-out visitor has — but a signed-in customer now also has
> a server mirror (`BagLine`, `WishlistItem`) reconciled by
> `components/AccountSync.tsx`, so a bag follows them to a new device. The
> reasoning below about ids-only, `useSyncExternalStore` and stale-line pruning
> is unchanged and applies to both halves.

### Ids only, never a copy of the product

A line holds an id and (for the bag) a quantity. Names, prices and images are
resolved against the live catalogue wherever the list is rendered. Storing a
copy would mean a bag showing whatever the price was on the day the item went
in — and totalling from it. Editing a price in `/admin` changes an existing
bag immediately, which is the correct behaviour.

### `useSyncExternalStore`, not state in an effect

Both genuinely live outside React. That API gives the server snapshot for free
— always empty, which is all a server can honestly know about a browser's
storage — so hydration never mismatches, and the cross-tab `storage` event is
just another source on the same subscription. Two tabs are one bag.

Badges wait on a `hydrated` flag before rendering. A count drawn before the
stored list is read would either mismatch the server markup or flash a wrong
number.

### Stale lines are removed, not just hidden

A product can leave the catalogue while it sits in someone's list. Those lines
are pruned from storage by the page that holds the catalogue, and the store
reports how many went so the notice can survive the removal it describes. The
alternative — hiding them — leaves the header badge counting items the page
will never show.

### Three bugs that only testing found

- Two fast clicks on the quantity controls both computed from the last
  *rendered* quantity, so the second did nothing: five with three rapid
  decreases landed on four. The controls apply a delta against stored state.
- The bag summary counted unresolved lines, reading "8 items" beside a
  subtotal for three.
- The wishlist heart sits inside the card's link to the product, so saving
  also navigated away. It stops the event.

### What is deliberately inert — mostly no longer inert

The rule this recorded is still the right one: *a control that looks live and
goes nowhere is worst at the exact moment someone has decided to buy.* Two
things followed from it, and only one still holds.

- ~~Checkout says "coming soon" rather than looking like a button.~~
  **Resolved by §26.** `/checkout` exists and works, so the honest thing is no
  longer a disabled label — it is a real link, which is what
  `components/BagContents.tsx` renders.
- **Delivery still says "calculated at checkout"** rather than promising free
  shipping there is no rule for. §27 added a pincode check that shows a
  courier's quoted rate, but nothing charges it: every order still stores
  `shipping: 0`. The claim on the page stays deliberately vague because it is
  still the only honest thing to say.

## 22. Category groups

"Clothing" and "Accessories" are not categories a product can be in — they are
what a category is part of. A jacket is both a jacket and clothing, so making
Clothing a sibling would have forced products to pick one, and picking
"Clothing" would have thrown away the fact that it is a jacket.

`Category.parentId` models it instead. A group's collection page shows
everything in its children, and its count is the sum of them — `productsIn` in
`lib/categoryCounts.ts` matches the group's own id as well as its children's,
so a product assigned directly to a group is not invisible. (This paragraph
used to say the group's `itemCount` "is ignored because the page counts the
catalogue itself". That field no longer exists — §30 — and the groups showed a
literal 0 on every surface that did trust it.)

**One level, enforced.** Publishing refuses a category whose parent is itself
inside a group, and refuses a category that is its own parent. The admin's
group selector only offers top-level categories, so the invalid shape is not
expressible through the UI either. Deeper nesting is a menu nobody navigates
well, and every layout here would need a recursive case for a depth that never
occurs.

**Groups do not appear in the homepage rows or the collections index.** Those
list categories a product can actually be in; a Clothing row would open a page
showing the same garments as the four rows beneath it. `leafCategories()` is
the single definition of "a category, not a group".

**The rail shows the hierarchy by indenting**, from a flat list carrying a
`nested` flag rather than a tree — the rail only ever draws one level, and a
tree would make every consumer handle a depth that cannot occur.

This also resolved two of the three dead nav links: `/collections/clothing` and
`/collections/accessories` now exist. `/collections/series-026` does not — that
one is a drop, not a category, and is still a broken link in the lookbook.

## 23. Search

`/search?q=` over the published catalogue, matched on the server.

**No index, no ranking library, no fuzzy matching.** The catalogue is tens of
products, not tens of thousands; anything more would be machinery standing in
for an answer. It can be replaced when the catalogue justifies it — the
matching is one file with no callers beyond the page.

**What it searches is the point.** A shopper types "jacket", "cargo" or
"parka", and only some of those are in a product's name. Category name and alt
text are searched too, because that is where the garment is actually described.
Searching names alone returns nothing for most of what people type.

**Every token must match.** "technical shell" returns fewer results than
"shell", not more — someone who typed two words meant both.

**Ranking is by where the match landed**: a name starting with the query, then
a name containing it, then a match on category or description only, with the
whole query appearing intact scoring above the same words scattered. Ties break
alphabetically so results never reshuffle between identical searches.

**Collections are offered alongside products.** Searching "jackets" shows the
Jackets collection as a chip above twelve products, because that is usually
what was meant. Groups are excluded — Clothing and Jackets would both match and
offer two links to overlapping lists.

### The form works before JavaScript does

`action="/search"` and `method="get"` on a real form, with the submit handler
only upgrading it to a client-side navigation. Someone can type and press Enter
the moment the markup arrives; if hydration never finishes, the browser submits
it anyway. An empty query is refused rather than landing on a results page for
nothing.

Phones get a link to `/search` rather than the field, which would crowd out the
wordmark at that width.

## 24. The database, and customer accounts

Everything before this point ran without one. The catalogue is a JSON document,
the bag is `localStorage`, and the admin is two environment variables — which is
why the site has always been deployable as a folder of static-ish pages. That
stops being enough the moment an order has to exist, so Postgres arrives here,
before checkout rather than alongside it.

**Prisma 7 with the `@prisma/adapter-pg` driver adapter, against a pooled
connection.** The pool matters more than the ORM: on a serverless host each
request can be its own process, and one direct connection per request exhausts
the database's limit long before real traffic does. `DIRECT_DATABASE_URL` exists
only for `prisma migrate`, which needs an advisory lock a transaction-mode
pooler cannot hold.

The generated client is written to `lib/generated/prisma` — outside `app/`,
because everything under the App Router is scanned for route files — and is
gitignored. `npm run build` runs `prisma generate` first, so the deploy target
does not need it committed.

**The database is a capability, not a requirement.** `hasDatabase()` is checked
rather than assumed: with `DATABASE_URL` unset the storefront behaves exactly as
it did before, and the account pages say accounts are unavailable instead of
five hundred different pages throwing. The Prisma client itself is built behind
a lazy proxy for the same reason — a build that never touches the database does
not need one to exist.

### Customer sessions are rows; the admin's is still a token

Two auth systems now sit in the same repo, and the difference is deliberate.

The admin session (§17) is a stateless JWT. It is one person on one laptop, and
it is verified in middleware, which runs on the Edge and must not open a
database connection. Not being able to revoke it is an acceptable trade for
that.

A customer session is a stranger's phone. It has to be revocable — "sign out",
and later "sign out everywhere" after a password change — and revoking is
exactly what a self-contained token cannot do. So `CustomerSession` is a row,
the cookie holds a random opaque token with no structure to tamper with, and
only its SHA-256 digest is stored: a leaked dump contains nothing replayable as
a login.

Passwords are **scrypt from `node:crypto`**, not bcrypt or argon2. Both of those
are native addons — a build toolchain on install, a matching binary on the
deploy target — and neither buys anything scrypt does not already give. The cost
parameters are written into every stored hash, so raising them later does not
invalidate existing passwords.

Sign-in hashes a dummy password when no account matches, so "no such email" is
not measurably faster than "wrong password". That is the same disclosure the
single shared error message exists to prevent, and fixing one without the other
fixes neither.

### The bag: localStorage is the authority, the account is a mirror

The obvious design is to move the bag into the database once someone signs in.
It is wrong. It makes adding an item a network round trip, breaks the bag
entirely on a flaky connection, and turns every product page dynamic — for a
feature whose whole appeal is that it is instant.

So the bag stays where it is, and signing in adds a *second* copy.
`components/AccountSync.tsx` reconciles them once per page load and mirrors
every change afterwards, debounced, flushed when the tab hides. A failed sync is
never surfaced: what is on screen is correct either way, and the next change
re-sends the whole list.

The one moment the server wins is the merge, which is the only moment it knows
something the browser does not — what this person's other device did. On a
quantity clash **the larger wins, never the sum.** Adding them is the tempting
choice: the common case is one person adding the same jacket on a laptop and
then on a phone, and that person wants one jacket. Doubling someone's order
because they signed in is a mistake they might only notice after paying.

### The content store's second adapter

§15 said moving off the JSON file meant writing one more `ContentStore` adapter
and nothing else. `lib/prismaContentStore.ts` is that adapter, and the claim
held: no route, component or editor changed.

The document is stored whole, in a `Json` column, exactly as the file adapter
stores it whole in a file. Shredding it into tables would put the schema in two
places — `data/types.ts` and a migration — and every future field would have to
be added to both. The retry the file adapter needs against torn reads is
deliberately absent here; a row is written atomically.

Postgres is selected as soon as `DATABASE_URL` exists, not only when asked for.
A project with a database configured and the file adapter still running works
perfectly in development and fails on its first publish in production, which is
the worst possible time to find out. `CONTENT_STORE_DRIVER` overrides it in both
directions.

Switching drivers moves nothing — the two stores are separate places — so
`npm run content:import` carries an existing `.content/site.json` across once.
Without it the site falls back to the `/data` seed and looks as though every
edit was lost.

**Uploaded images are the remaining piece.** §15b writes them to
`.content/uploads/`, which still needs a writable disk. Content and accounts now
survive a read-only filesystem; images do not.

### `prisma.config.ts` must not need a database to load

Two traps, both of which made the database a requirement rather than a
capability — the exact thing this section claims it is not.

Prisma's `env()` helper **throws** on a missing variable rather than returning
undefined, so `env("DIRECT_DATABASE_URL") ?? env("DATABASE_URL")` never reaches
the fallback: the whole config fails to load. Since `npm run build` runs
`prisma generate` first, and generating a client needs no database at all, that
made a database mandatory to build the site. The URLs are read from
`process.env` instead, and the datasource is omitted entirely when neither is
set — `generate` succeeds, and the commands that genuinely need a connection
fail on their own with their own message.

The CLI also does not read `.env.local`; Next does. A `DATABASE_URL` that works
for the app was invisible to `prisma migrate`, which reported a missing
variable sitting in a file three lines long. The config loads `.env.local` and
then `.env`, neither overriding an already-exported shell variable, so a
one-off migration against a different database still works the way it looks
like it should.

### Reading the session in the root layout

`app/layout.tsx` is now `async` and calls `getCustomer()`. `cookies()` is a
request-time API, so this opts every route out of static prerendering.

That is the intended trade rather than an oversight. The storefront wants
request-time rendering anyway: its catalogue and copy come from a store that
`/admin` rewrites at runtime, and a page frozen at build time keeps serving
whatever was published the day it was deployed. Only the boolean crosses into
the client tree — the customer's name and email stay on the server, where the
pages that need them read them directly.

## 25. Hardening the admin

§17 described a session that could not be revoked and a rate limiter that reset
on every cold start, and accepted both because there was no database. §24 added
one. This closes them.

### Rate limiting, in Postgres, on two keys

The `Map` was not a small problem. On a serverless host every request can be a
fresh process, so the counter reset constantly and the effective limit was
"five attempts per instance" — against `/admin/login`, which is the only thing
between a stranger and an unlimited guessing loop.

Postgres rather than Redis or Vercel KV, which §17 suggested: there is already
a connection open for everything else, and a second datastore for six columns
is a second thing to provision, a second thing to fail, and a second place for
the answer to live. The write volume is a handful of rows per failed login.

**Two buckets, counted separately.** IP alone lets a botnet spread guesses
thinly enough never to trip the limit. Identifier alone lets anyone lock the
real administrator out of their own account by guessing at their username from
anywhere. Both are checked, and the more restrictive answer wins.

**Exponential backoff.** A fixed ten minutes is a limit an attacker waits out
forever, five guesses at a time. Doubling to a capped 24 hours means a script
puts itself out of action for a day, while someone who mistyped twice this
month never notices. `lockoutCount` survives the window reset deliberately —
otherwise the backoff would restart every time and never escalate.

### Fail closed for the admin, open for customers

If the limiter itself errors, the two callers want opposite things, and getting
it backwards is worse than having no limiter at all.

The **admin login fails closed**: no counter, no attempt. There is one
administrator and they can wait a minute; the alternative is that anyone able
to make the database unreachable has also removed the only brute-force control
on the account that can rewrite the entire site.

**Customer sign-in fails open**: a shopper locked out by a database blip is a
lost sale and a support message, and one account behind a scrypt hash is worth
less than the storefront staying usable.

### Turnstile, verified server-side

Endpoint, parameter names, response fields and error codes are from
Cloudflare's siteverify reference, not from memory. The token is verified in
the server action every time — a widget that renders and is never checked is
decoration, and anyone posting straight to the action never sees the widget at
all.

`remoteip` is sent because Cloudflare uses it as a signal, and
`idempotency_key` so that a retry after a network wobble is not counted as a
second redemption.

**Reuse is enforced, not assumed.** Cloudflare documents tokens as single-use
and returns `timeout-or-duplicate` on reuse, but "documented as" is not
"enforced by us": a hash of every accepted token is recorded, so one solved
challenge cannot be replayed even if siteverify's own window softens.

Verification failing — Cloudflare unreachable, or slower than the timeout —
**fails closed**. A captcha that waves everything through the moment it cannot
reach its verifier is one an attacker disables by making a single host
unreachable.

**Unconfigured behaves differently by surface, deliberately.** The customer
forms skip the check so development works without a Cloudflare account. The
admin login refuses to sign anyone in and says the server is misconfigured. An
admin login that silently drops its captcha when an environment variable goes
missing is worse than one that never had it, because everything keeps working
and nobody finds out until the logs are read months later.

### Revocable admin sessions, without giving up the Edge check

The token now carries a session id, and `AdminSession` is a row.

- `middleware.ts` verifies the **signature** on the Edge. It opens no
  connection, so it cannot know whether the session was revoked. Its job is to
  stop a signed-out URL rendering admin markup before it redirects.
  **Middleware is not authorization**, and the file says so.
- `lib/adminSession.ts` verifies the **row** on the Node runtime — present, not
  revoked, not expired, not idle. The dashboard layout calls it before any page
  renders, and every admin action calls it before doing anything, so a revoked
  session's still-valid token is worthless on its very next navigation.

Putting the row check in middleware instead would mean a database round trip on
every asset and every prefetch, from a runtime that cannot hold a pool.

The username is read from the row, not the token. They cannot disagree today,
but the row is the record and the token is a copy of it — reading the copy is
how the two quietly drift apart later.

**Revoked, not deleted.** "Signed out at 14:02 from this address" stays
answerable afterwards; a delete erases the evidence at the exact moment someone
is trying to work out what happened.

**Sliding expiry** with a five-minute touch debounce. Without the debounce every
image and every prefetch would be an UPDATE; five minutes of drift on a "last
seen" column costs nothing.

### The audit log

Who, what, when, from where — the question nobody can answer from the content
store alone, because a published document only records its current state.

`recordAudit` never throws. An action that succeeded and then failed to log has
still succeeded, and turning that into an error the operator sees would make the
log a new way for publishing to break. The trade is that a failed write is
silent, which is the wrong answer for tamper-evidence and the right one for an
operational record kept by a single administrator.

Actions are a union type, not free strings: a log where one publish is
`content.publish` and another is `publish_content` cannot be filtered, and the
mistake is invisible until someone needs it.

**Never a credential.** No passwords, no tokens, no captcha secrets, no request
bodies. A failed sign-in records the attempted *username* and never the
attempted password — knowing which account was targeted is the point, and
storing a near-miss of the real password in a readable table is not.

### Headers, and what the CSP does not do

`script-src` keeps `'unsafe-inline'`, and that is worth being honest about
rather than quietly shipping. Next's App Router injects an inline bootstrap and
inline flight data on every streamed response. Removing it means a per-request
nonce, which means every page renders dynamically — and the storefront's
collection and product pages are statically generated today. Trading the whole
static-rendering story for one directive is not a good trade at this size.
`'unsafe-eval'` is absent, and so is any wildcard host. Turnstile propagates a
nonce to its own resources and supports `'strict-dynamic'`, so tightening this
later is a change to one file rather than a redesign.

`/admin` is `noindex` **at the header level**, not only in page metadata. A
`<meta>` tag is only read if the crawler renders the page, and every admin URL
redirects to a login screen before rendering anything — the tag a crawler would
need is on a page it never reaches. Verified against a production build: the 307
redirect carries `X-Robots-Tag` and `Cache-Control: no-store`.

`no-store` is set in middleware as well as in `next.config.mjs`, because Next
overrides the config value with its own `no-cache, must-revalidate` on
dynamically rendered routes. `no-cache` still lets a shared cache *store* a
signed-in admin page and merely revalidate it; `no-store` is the one that says
it may not keep a copy at all.

Admin cookies are `sameSite: strict` where the customer's are `lax`, and
`path: /admin` rather than `/`. The admin has no cross-site entry point —
nothing links into it and there is no OAuth callback to return from — so the
looser setting would buy nothing, and the storefront has no use for the cookie.

## 26. Checkout and orders

The brief asked for this as §25. That number was already taken by the admin
hardening, so it is §26 — renumbering a section other notes point back to would
have been worse than being one off from the request.

Payments and shipping are deliberately absent. What is here is the record an
order is, and a seam where a payment provider goes.

### An order snapshots; a bag resolves

This is the difference between `OrderItem` and `BagLine`, and it is the reason
both exist.

A bag stores a product id and nothing else (§21), so it always resolves against
the live catalogue. Change a price in `/admin` and every bag holding that
product shows the new price. That is correct: nobody has agreed to anything.

An order is a record of an agreement. It must say what was bought, at the price
charged, under the name the customer saw. If it resolved the way a bag does,
renaming a product would rewrite old invoices, deleting one would empty a past
order, and a price rise would retroactively change what someone paid. So the
title, price and image are copied at purchase and never touched again.

`productId` is kept beside the snapshot with **no foreign key**, purely so "buy
it again" can find the product if it still exists. A relation would let a
deleted product cascade away a line of somebody's order.

### Money is paise, as an integer

Every stored amount is an `Int` of paise. `0.1 + 0.2` is not `0.3` in binary
floating point, and a rounding error in a currency column is the kind of bug
found by a customer adding up their own invoice.

The catalogue is authored in whole rupees, which is a different unit, so the
conversion lives in exactly two places: `rupeesToPaise` on the way in and
`formatPaise` on the way out. `formatPaise` is deliberately separate from
`formatINR`, which takes rupees — one function accepting both would mean every
caller had to know which it was passing, and the failure mode is a price wrong
by a factor of a hundred.

### The browser never sends a price

The checkout form submits product ids and quantities. No prices, no line
totals, no order total. `checkoutSchema` has no field for them, so a smuggled
one is stripped rather than validated.

The bag is priced **twice**, from the catalogue: once to render the summary,
and again inside `createOrder` immediately before writing. Separate reads on
purpose — a price can change between someone opening checkout and pressing the
button, and the second read is the one that decides. Rendering a total and then
trusting it would let a stale tab buy at yesterday's price.

Accepting a total the server then "verifies" would give the checkout two
sources of truth for what something costs, with the customer controlling one.

### Guest checkout, and the signed link

`customerId` is nullable. Requiring an account at checkout is the most reliable
way to lose a first sale, so the model treats guests as a supported case rather
than an exception the page has to work around.

That creates a problem: order numbers are sequential and human-readable, so
`/orders/VNT-2026-00042` would hand the previous customer's name, phone and
address to anyone who could count. Guests reach their order through an HMAC of
the order number under the existing session secret — unguessable, tied to that
one order, needing no storage.

Not expiring. A delivery confirmation is worth reading weeks later, and a link
that dies after an hour sends people to support instead.

A signed-in customer is authorised by session and gets **no** token: handing a
shareable credential to someone already authorised puts one in their URL bar
for no reason. An order belonging to someone else is `notFound`, not
"forbidden" — saying it exists but is not yours confirms it exists.

### The order number is not the key

`VNT-2026-00042` is what a person quotes on the phone. The cuid remains the
primary key, because order numbers are generated under contention: counting
this year's orders and adding one races, and the unique index is what makes
that safe. A collision fails the insert and the action retries, rather than two
orders sharing a number or a relation pointing at the wrong row.

A Postgres sequence would avoid the race and cost a migration plus a second
source of truth for a display string. At this volume a retry loop is cheaper,
and the failure mode is a unique violation rather than corruption.

### One transaction, including the bag

The order, its lines, the cleared server-side bag and an optionally saved
address are one transaction. An order with no lines is not a lesser order, it
is a corrupt one. And if the bag were cleared afterwards and that failed, the
customer would have an order and a full bag, and their next device sync would
put the just-bought items back.

The **client** bag is cleared separately, by the order page, because
`localStorage` is the authority (§21) and the server cannot reach it. Clearing
it optimistically before the redirect would empty someone's bag on a redirect
that then failed. Arriving on the order page is proof the order exists, and
`?placed=1` distinguishes that arrival from someone opening the same link from
a confirmation email weeks later — who must not have their current bag wiped.

### ONLINE stops at PENDING_PAYMENT

There is no payment provider. Choosing "Pay online" writes a real order in
`PENDING_PAYMENT` and says plainly that nothing was charged. A provider slots
in by capturing against an existing order and moving it to `CONFIRMED`.

The alternative — hiding the option until payments exist — would have made the
seam theoretical. The alternative to *that*, a "Pay now" button leading nowhere,
is worst at the exact moment someone has decided to buy.

### Shipping is zero because there is no rule

The trust strip promises free delivery over ₹1,999, but there is no rate table
and no serviceability check, so charging anything would be inventing a number.
The columns exist on the order so adding a real rule later is a calculation
change rather than a migration on a table with orders in it. The summary says
"calculated later" rather than "free".

### A prerendering bug this uncovered

`/checkout`, `/account` and `/orders/[orderNumber]` all built as **static**.

§24 recorded that reading the session in the root layout opts every route out
of static prerendering. It does not, in one configuration: `getCustomer()`
returns early when no database is configured, **before** it reaches `cookies()`,
so the request-time API that would have marked the route dynamic is never
called. With a database they become dynamic by side effect — which is a
coupling that breaks silently, and did.

All three now declare `force-dynamic` explicitly. `/bag` stays static on
purpose: it is a shell hydrated from `localStorage` with no per-user server
data in it.

## 27. Payments and courier delivery

Two integrations, added in that order: Razorpay for taking money, Shiprocket
for moving parcels. They share one rule, and almost everything below is
downstream of it — **an outside service must never be able to stop an order.**
A payment provider can be slow and a courier can be down, and neither is a
reason to tell a customer who has decided to buy that they cannot.

### The webhook is the source of truth for payment, not the browser

Razorpay's checkout hands control back to the browser when a payment finishes,
and the shortest possible implementation marks the order paid right there. It
is also wrong, and wrong in a way that loses money silently.

The browser is not a reliable narrator of a payment:

- **It may never come back.** A UPI payment completes inside a banking app. The
  customer's phone rings, they take the call, the tab is gone. The money moved
  and nothing told us.
- **The network may drop** between the bank confirming and our callback firing.
- **The customer's machine makes that request**, which means the customer can
  make it too, with arguments of their choosing. An order marked paid by a
  request anyone can forge is not a paid order.

So `app/api/webhooks/razorpay/route.ts` is the only thing in the codebase that
writes `paidAt`. Razorpay delivers that event regardless of what the browser
did. The client component after checkout does exactly one thing with a
successful payment: refreshes the page and shows "confirming" until our own
database says otherwise. It never claims "paid" on its own authority.

Three properties make that safe:

- **The signature is verified before anything else.** The raw body is read as
  text — not `request.json()`, because the HMAC is over the bytes, and parsing
  then re-serialising changes key order and whitespace so the signature never
  matches. Nothing is parsed, read or written until it checks out. The endpoint
  is public by nature; an unsigned request is a stranger, and a stranger must
  not be able to cause so much as a row to be written.
- **Idempotency comes from a unique index, not from reading first.** Every
  delivery inserts into `WebhookEvent` under `@@unique([provider, eventKey])`
  *before* any work happens. A check-then-act read would race a concurrent
  redelivery; the database does not.

  > **Amended by §29.** This paragraph used to end "A duplicate raises P2002,
  > returns 200, and changes nothing." That was the bug, not the design. The
  > insert-first ordering is right and survives; treating the row as *proof of
  > completion* was wrong, because it was written before the handler knew
  > whether it could act. Every no-op exit path — `unknown-order`,
  > `amount-mismatch` — permanently consumed the key, and the redelivery that
  > would have fixed things was answered 200 and discarded. The row is now a
  > claim; `processedAt` is completion. See §29.
- **The status update is conditional.** `updateMany` with
  `status: "PENDING_PAYMENT"` in the WHERE clause makes it one atomic
  statement, so `payment.captured` and `order.paid` can arrive for the same
  payment and race, and exactly one of them updates a row.

`payment.failed` deliberately does **not** cancel the order. A declined card is
routinely followed by a successful one a minute later against the same Razorpay
order; cancelling would destroy an order mid-purchase.

The amount is re-checked against `Order.total` before confirming. It comes from
an order we created server-side, so a mismatch should be impossible — but the
cost of being wrong is shipping goods for less than they cost, and the check is
one comparison.

### The order is written first, the payment second

`createOrder` commits our order and *then* asks Razorpay for theirs. That
ordering is deliberate: theirs is only ever created once ours has committed, so
there can be no Razorpay order for an order that was rolled back.

> **Amended by §29.** This used to claim the ordering meant "a database failure
> can never leave a Razorpay order with no local counterpart — a payment nobody
> could reconcile". The ordering does not buy that, and the gap was one line
> further down: the `razorpayOrderId` linking update ran *after* their order
> existed and swallowed its own failure with `.catch(() => {})`. A pool timeout
> there produced exactly the state the sentence promised was impossible — live,
> payable, unmapped. The write now logs on failure, and the webhook can recover
> the mapping from the order number Razorpay echoes back. §29.

The handoff is also best-effort. If Razorpay is unreachable in that moment the
order still exists, and the order page offers to start the payment again
(`app/orders/[orderNumber]/actions.ts`), reusing the existing Razorpay order if
there is one. Creating a second would mean two payment surfaces for one debt,
and a customer could pay both.

### What could not be verified

The Orders API and the webhook signature scheme were read from Razorpay's
current documentation. The exact **nesting of webhook payloads**
(`payload.payment.entity`) could not be — those pages 404 at the time of
writing. Rather than hard-code a guess that would fail silently,
`readWebhookFacts` reads the entity from the documented path *and* the obvious
alternatives, and returns null — answering 422, not 200 — when it recognises
nothing, so their retries keep an unparseable event visible instead of
swallowing it. Confirm against a real test event before going live.

### Shiprocket, built against fetched docs

Their shapes were read from `apidocs.shiprocket.in` and the Postman collection
it publishes, while writing the code, rather than recalled. The endpoints used
are `auth/login`, `courier/serviceability/`, `orders/create/adhoc`,
`courier/assign/awb` and `courier/track/awb/{awb}`.

**The token is cached, not re-fetched.** Their helpsheet states a token is
valid for 240 hours. Logging in per request would be wasteful and, against a
rate-limited login endpoint, a way to get locked out during a traffic spike.
The cache is three deep: a process-local variable, then an `IntegrationToken`
row, then an actual login. The row exists because this deploys serverless —
every cold start is a fresh process, and a process-local cache alone would mean
a login on each one. A 401 invalidates and retries once, so a token revoked on
their side becomes a transparent re-login rather than a week of failures.

**Serviceability is cached in memory for six hours.** It changes on the order
of days, and the same handful of pincodes get checked over and over — a product
page, then the bag, then a reload. Deliberately not in Postgres: it is derived,
disposable data whose worst failure is one extra API call, and a table would
need a model, a migration and an eviction story for something a `Map` handles.

### Nothing in the buying path waits on the courier

Not one function in `lib/shipping/shiprocket.ts` throws. They all return a
discriminated result and let the caller carry on. Pushing an order is queued
through `lib/outbox.ts` — a row written **inside the same transaction as the
order**, which no external queue could be — and performed later by
`/api/courier/sync` or by an admin pressing a button. If Shiprocket is
unreachable for six hours, six hours of orders sit in the queue and the
customers who placed them never see a thing.

The queue backs off (roughly 1m, 5m, 25m, 2h, 10h) and never deletes a job. A
job that has failed twenty times is something staff should see in
`/admin/orders`, not something that disappeared along with the order it was
supposed to ship.

The distinction between "not serviceable" and "we couldn't check" is enforced
everywhere it appears. Telling someone their address is undeliverable because
an API timed out ends the visit for no reason, so a failed check is `unknown`
and the page says you can still order.

### Delivery status: their words, our enum

`courierStatus` stores the courier's own string, and the order page shows it
verbatim — "Out for delivery" tells a customer more than any status of ours
could. `courierStatusToOrderStatus` answers only the narrower question of
whether one of *our* few boundaries has been crossed, and it never moves an
order backwards: courier scans arrive late and out of order often enough that a
DELIVERED order reverting to SHIPPED is a real risk, and it is impossible to
explain to the person watching. An unrecognised status changes nothing.

A courier may not cancel an order. "Canceled" from their side means the
shipment was cancelled — a shipping problem for staff to resolve — while the
order may still be owed, paid for, and about to be re-shipped.

### Webhook *and* polling

The tracking webhook is the primary path; `/api/courier/sync` polls as a safety
net, scoped to orders that have an AWB and are not yet delivered. A webhook
delivered while the site was mid-deploy would otherwise leave an order stuck on
a status it left days ago. Polling only active shipments keeps a cheap safety
net cheap — polling every order ever placed would grow linearly forever.

Their webhook carries a shared token, not a signature, so it is authenticated
but not tamper-evident. That shapes what it is permitted to do: it updates
delivery state and nothing else. It cannot mark an order paid, change a total,
or create anything. With `SHIPROCKET_WEBHOOK_TOKEN` unset it refuses everything
rather than accepting everything.

Their documentation also states that the webhook URL must not contain the
keywords "shiprocket", "sr", "kartrocket" or "kr" — which is why the route is
`/api/webhooks/courier`. Registering the obvious name would have been rejected
on their side, and the symptom would have been tracking updates that simply
never arrived.

### Parcel dimensions come from configuration

Shiprocket requires length, breadth, height and weight, and rejects zeroes.
This catalogue records none of them — it is clothing, and there is no weight
field anywhere in the content model. So they are environment variables: one
conservative parcel for the whole catalogue. Inventing a per-order number would
be worse, because their rate is charged on volumetric weight and a wrong guess
becomes a wrong invoice.

### Units, converted at the boundary

Everything internal is paise. Razorpay also takes paise, so nothing is
converted, and that is stated in a comment — a unit change between our total
and theirs is exactly where a factor-of-100 bug lives. Shiprocket's API is in
rupees, so `paiseToRupees` is applied once, in `lib/shipping/courierPush.ts`,
at the edge.

### The scheduled sync was removed for Hobby-plan deploys

`vercel.json` declared `/api/courier/sync` at `*/15 * * * *`. That is not a
schedule Vercel will accept on a Hobby account, and the failure mode is the
worst kind: **the deploy fails outright**, so the first time anyone finds out is
when they are trying to put the site in front of somebody.

Confirmed against Vercel's live docs rather than from memory
(`/docs/cron-jobs/usage-and-pricing`, checked 2026-09-02): Hobby is limited to
*once per day* with *per-hour* precision — a job set for 01:00 fires somewhere
in the following 59 minutes. Pro and Enterprise allow once per minute. The
rejection message is explicit: "Hobby accounts are limited to daily cron jobs.
This cron expression would run more than once per day."

The `crons` block is gone; `vercel.json` now carries a `buildCommand` instead.
**The route is untouched** — `/api/courier/sync` still exists, still requires
`CRON_SECRET`, and still does exactly what it did. Only the schedule that called
it was removed.

Nothing about correctness depends on it, and that is by design rather than luck.
The section above states the shape: the tracking webhook is the primary path and
the sync is the safety net under it. With no scheduler the net is simply not
strung — a webhook that goes missing leaves an order on a stale status until
someone looks, and `/admin/orders` has a button that drains the push queue by
hand. Orders are still taken, still recorded, still pushed to the courier by the
outbox. Nothing that touches money or a customer's expectations moves.

Three ways to put it back, and the middle one is easy to miss:

1. **Leave it off.** Correct for a demo, and what ships today.
2. **A once-daily cron, which Hobby does allow** — `0 3 * * *`. A safety net
   whose job is catching a dropped webhook does not need fifteen-minute
   granularity, and daily is a large improvement on never. This is the option
   worth taking the moment the site has a real customer on a Hobby plan.
3. **Pro, or an external scheduler** hitting the route with `CRON_SECRET`. Only
   worth the money once tracking freshness is something a customer would notice.

Re-adding it is a `crons` block in `vercel.json` and nothing else. `CRON_SECRET`
must be set or the route refuses the call — which is the correct behaviour, but
it does mean a re-added cron that silently 401s looks exactly like a cron that
is not running.

## 28. Fix-up pass: sign-out, migrations, and the token at rest

No new features. Five defects found by reading the code that §24–§27 left
behind, and what each one turned out to actually be.

### The sign-out loop was a cookie path, and then it wasn't only that

`ADMIN_COOKIE_OPTIONS` sets `path: "/admin"`. Both `logoutAction` and
`middleware.ts` cleared the cookie by bare name, which defaults to path `/`. A
browser matches a deletion on name **and** path, so the two never matched and
the cookie survived every sign-out.

The session row *was* revoked, so this was never an auth hole — nothing could be
done with the surviving token. What it produced instead was an infinite
redirect: `/admin/login` → middleware sees a validly-signed JWT → `/admin` → the
dashboard layout checks the row, finds it revoked → `/admin/login` → forever.
Measured before the fix with `curl -L` against a real revoked session: six hops
and still going.

The fix is not "delete it with the path in both places". That is the same
mistake written twice more. The actual defect was that the set lived in
`lib/session.ts` and the clears lived as bare literals in two other files —
**two copies of a value that must agree, which is a thing that drifts.** So
there is now an `ADMIN_COOKIE_CLEAR` beside `ADMIN_COOKIE_OPTIONS` whose path is
*derived* from it rather than restated, and both callers use it.

`lib/auth/customerSession.ts` was checked for the same mismatch and did not have
one — that cookie is set at `/` and deleted at the default `/`, which agree. Its
options were still lifted into a named constant, because they agreed by accident
rather than by construction.

#### Fixing the cookie did not close the loop

Worth recording, because it is the part that would have been missed by treating
this as a one-line fix. Sign-out was only *one* way into that state. Revoking a
session from the Security page puts the revoked browser into exactly the same
loop on its next navigation, with no cookie bug involved at all: a valid
signature that middleware accepts, and a dead row that the layout rejects.

The structural cause is §17/§25's accepted trade — middleware runs on the Edge
and cannot check revocation. Neither middleware nor the layout can clear the
cookie either: a Server Component has no response headers to write to.

A Route Handler does. `app/admin/signed-out/route.ts` clears the cookie and
redirects to the login form, and the layout now sends unauthenticated requests
there instead of straight to `/admin/login`. Middleware waves it through (the
signature is still valid), the cookie goes, and the redirect that follows finds
nothing and lands on the form. Verified: six-plus hops → two hops, HTTP 200, on
the login form, with `Set-Cookie: …; Path=/admin` observed on the way past.

Anything that adds a new redirect into `/admin` should be checked against this
loop.

### There were no migrations at all

`prisma/migrations/` did not exist. The schema and the generated client were
present, so `prisma db push` had been used throughout — which is fine for
iterating locally and useless for deploying, because `npm run db:deploy`
(`prisma migrate deploy`) applies migration files and there were none. A fresh
production database would have come up **empty**, and the failure would have
surfaced as every query erroring at runtime rather than as a failed deploy.

A baseline now exists, generated by `prisma migrate dev` against a scratch
database rather than hand-written, and verified three ways:

- It applied cleanly to a genuinely empty database via `npm run db:deploy`.
- `prisma migrate diff --from-config-datasource --to-schema` reports **"No
  difference detected"** against the resulting database — so it reproduces the
  schema exactly, not approximately.
- Counted by hand against `schema.prisma`: 14 models → 14 `CREATE TABLE`, both
  enums, and 24 indexes (19 `@@index` + 1 `@@unique` + 4 field-level `@unique`).

`db push` is now explicitly not the deploy path, and the README says so.

One operational note: anyone who already has a `db push`-ed database will have
the tables but no `_prisma_migrations` row, so `migrate deploy` will try to
create what is already there. That is what
`prisma migrate resolve --applied <migration>` is for — it is a one-time
bookkeeping step, not a schema change.

### The Shiprocket token: encrypted, and why that was not a close call

`IntegrationToken.token` held a bearer token with full access to the Shiprocket
account — read every customer's name, address and phone, create and cancel
shipments, spend money — in plaintext, in a codebase that hashes every other
secret it stores. Admin passwords go through scrypt; customer session tokens and
Turnstile tokens are kept as SHA-256 digests.

A digest is not available here: the token has to be replayed to Shiprocket
verbatim, so the value itself must survive. That leaves encryption at rest, and
the usual objection to encrypting a column is key management — rotation means
re-encrypting existing rows, and losing the key means losing data.

**Neither applies here, and that is the whole argument.** This row is a *cache
of a re-derivable value*. A missing key, a rotated key, a corrupt payload and a
tampered ciphertext all resolve identically: throw the row away and log in
again. One extra login, no re-encryption pass, no key versioning, no data loss.
So this is a complete design rather than the first half of one — which is the
bar that would have justified leaving it alone instead.

`lib/crypto/secretBox.ts` does AES-256-GCM with a fresh 96-bit IV per
encryption, storing `v1.iv.tag.ciphertext`. The column is renamed
`tokenCiphertext`, because a column called `token` holding ciphertext invites
the next person to log it or compare it.

Two decisions inside it worth keeping:

- **No plaintext fallback.** With `SECRET_ENCRYPTION_KEY` unset, `encryptSecret`
  returns null and the caller simply *does not write the row* — the process-local
  memo still works, so the cost is one login per cold start. Writing the
  plaintext instead would be a silent downgrade of the exact property the module
  exists to provide.
- **No passphrase support.** The key must be exactly 32 bytes, base64 or hex.
  Stretching a passphrase with a fixed salt looks like key derivation while
  providing very little of it, and an operator who believes they have a strong
  key when they do not is worse off than one who is told to generate a real one.

What this buys, stated honestly: it defends against **database-only**
compromise — a leaked backup, an over-broad read grant, a dump pulled through an
injection. It does **not** defend against an attacker holding the environment,
who would have `SHIPROCKET_PASSWORD` and could just log in. The two leak through
different channels; closing the more common one is the point.

### Turnstile burned tokens it never verified

`verifyTurnstile` inserted the single-use marker **before** calling Cloudflare.
Any outcome burned the token, including the ones where Cloudflare never
answered — so a timeout or a dropped connection meant the visitor's immediate
retry, same widget and same token, came back `token-reused`. A network wobble on
Cloudflare's side became a dead form on ours.

The obvious repair — record only *after* a successful verification — is worse,
because it opens the window the marker exists to close: two requests carrying
the same token both reach siteverify before either has recorded anything.

So it is two phases. The claim still happens first and still relies on the
unique primary key to be atomic, and it is **released only when no verdict was
received** (transport failure, timeout, 5xx). A definite "no" from Cloudflare
keeps the claim, because that token is spent either way.

Verified with a harness that stubbed `fetch` to produce each outcome on demand:
a timeout releases the token and the same token then succeeds; a 5xx releases
it; a rejection keeps it burned; a redeemed token is refused; and of two
concurrent verifications of one token, exactly one succeeds. Re-run with the
release calls commented out, precisely those three release-dependent checks
fail — so the harness discriminates rather than passing vacuously.

### Two small things

- The admin layout claimed "the storefront is the opposite case and stays static
  on purpose". It has not been true since the root layout started calling
  `getCustomer()` — `cookies()` is a request-time API. The comment now says so,
  and keeps the sharp edge: the coupling is *conditional*, because with no
  `DATABASE_URL` that function returns before it reaches `cookies()` and the
  same code prerenders. §26 records how that silently made three routes static.
  A route's rendering mode should be declared, not inferred from whether some
  function happened to touch a request API.
- Deleted an empty junk directory tree at
  `app/admin/(dashboard)/app/admin/(dashboard)/pages`, untracked and containing
  nothing.

## 29. Webhook claims, payment recovery, and the scroll gauge

Two payment-path defects and one piece of storefront chrome. The two defects
are the same shape underneath: a step that *recorded* an outcome before it knew
what the outcome was.

### A webhook row is a claim, not a receipt

§27 got the ordering right and the meaning wrong.

Inserting into `WebhookEvent` **before** doing any work is correct and stays:
an insert that either succeeds or violates a unique index is the only thing
that beats a concurrent redelivery, where a check-then-act read would race. The
mistake was treating that row as proof the event had been *handled*. It was
written the moment the event was accepted, and every exit path below it left it
committed — including the ones that did nothing at all: `unknown-order`,
`amount-mismatch`, `no-order-id`, a thrown exception.

Razorpay then does exactly what it should. It retries, hits the unique index,
receives 200 with `{duplicate: true}`, and stops. Reproduced against a live
build:

```
delivery 1  -> {"ok":true,"ignored":"unknown-order"}   (event row written)
[the order row is written a moment later]
redelivery  -> {"ok":true,"duplicate":true}            (never processed)
order: PENDING_PAYMENT   paidAt: null   courier jobs: 0
```

A paid order, stuck for ever, with no signal that money had arrived. The
`unknown-order` path is not exotic — it is the ordinary race where the payment
webhook outruns the checkout transaction.

The fix separates *seen* from *processed* with two columns:

- The insert sets `processedAt: null` and `attempts: 1`. It claims the key.
- A unique violation now **reads the row**. `processedAt` set means a genuine
  duplicate — 200, change nothing, as before. `processedAt` null means an
  earlier delivery gave up part-way, so `attempts` is incremented and this
  delivery carries on and does the work.
- `processedAt` is stamped only on a terminal outcome: the order reached
  `CONFIRMED`, was already paid, or the event is one we deliberately ignore
  (`payment.failed`, anything outside `HANDLED_EVENTS`).
- Everything else returns **503** with `processedAt` left null, so Razorpay
  redelivers.

The conditional `updateMany` from §27 — `status: "PENDING_PAYMENT"` in the
WHERE clause — is what makes re-processing safe, and is now load-bearing in a
way it was not before: a delivery can legitimately run twice, and this is what
stops the second one re-stamping `paidAt`. It must not be relaxed.

Two subtleties worth writing down:

- **`updated.count === 0` has two causes.** The order was already paid (a
  sibling event — `payment.captured` and `order.paid` both arrive for one
  payment), or it is `CANCELLED`/`REFUNDED` and cannot accept payment. These
  need opposite answers, so the order is **re-read** after the update rather
  than trusting the snapshot taken before it. Already-paid is terminal.
  Not-payable is left unprocessed and logged loudly: no retry can fix a payment
  against a cancelled order, but it must not vanish either — somebody has to
  decide about a refund.
- **`amount-mismatch` is retryable, not terminal.** Consuming the key there
  would discard a corrected redelivery, which is the second half of the same
  bug.

### Unprocessed rows are a reconciliation queue

Which makes them worth showing. `/admin/orders` lists events with
`processedAt: null`, oldest first, with their delivery count and full event key
— the key being the thing you search the provider's dashboard for. The card
renders only when the list is non-empty: a panel that is empty 99% of the time
trains people to ignore it, and this is the one thing on that page that must
not be ignored.

The courier webhook shares the table, so it now stamps `processedAt` too.
Without that it would fill the queue with successful tracking updates and make
it useless for the case that actually matters. Its stakes are much lower — a
dropped tracking update is a stale status line, not lost money — but sharing a
table means sharing its conventions.

### Recovering a payment whose mapping was never written

`Order.razorpayOrderId` is written by a database call that runs *after*
Razorpay's order exists, and that call swallowed its own failure:

```ts
await prisma.order.update({ ... }).catch(() => {});
```

A pool timeout or a cold serverless connection there leaves a Razorpay order
that is live and payable with nothing on our side pointing at it. The webhook
looked orders up **only** by `razorpayOrderId`, so the customer could pay in
full and the payment would be unattributable — logging `unknown-order`, which
before the fix above also permanently consumed the event key. Two defects
compounding.

The information to recover was already being sent and simply never read back.
`createRazorpayOrder` sets `receipt: orderNumber` and `notes: { orderNumber }`,
so the mapping also lives on Razorpay's side, where our database being briefly
unavailable cannot touch it. Now:

- `readWebhookFacts` returns `orderNumber`, read from `notes.orderNumber` and
  `receipt` on both the payment and order entities — with the same
  shape-tolerance as everything else in that function, because the payload
  nesting is still unconfirmed against a real delivery.
- The route falls back to `findUnique({ where: { orderNumber } })` when the id
  lookup misses, and **backfills** `razorpayOrderId` on the way through so
  later events resolve directly and the recovery path runs once. The backfill
  is an `updateMany` guarded on the column still being null, because
  `razorpayOrderId` is unique and a blind write would throw if another order
  held it.
- The linking write no longer swallows its error. It still does not fail the
  checkout — the order exists and is correct, and the customer can pay from the
  order page — but the failure is now logged with both ids.

Verified end to end against `next build` + `next start` with a real Postgres:
25 assertions covering all five cases from the brief (late order, mismatch then
correction, `notes` fallback, `receipt` fallback, real duplicate, unsigned
request writing nothing) plus sibling-event racing and unhandled event types.

### Back to top, as an instrument

The storefront's register is instrumentation: spec-sheet rows, `tabular-nums`,
uppercase micro-labels, a reference code on every product page. A generic
floating chevron would have been the one control on the site that came from
somewhere else.

So `components/BackToTop.tsx` is a depth gauge. A ring closes as the page is
consumed and a `tabular-nums` readout gives the figure on hover or focus, the
way an altimeter shows a needle and a number. It earns its place twice: before
you press it, it is telling you how much is left — which the page did not
otherwise expose. It is the first consumer of `lib/useScrollProgress.ts`, which
had been written and never used.

**The dial is driven by a `MotionValue`, and that took two attempts.** The
first version read the progress into React state and put a
`transition-[stroke-dashoffset] duration-150` on the arc. It stuttered badly,
and the reason is worth keeping because it generalises: **a CSS transition
cannot smooth a value that changes every frame.** Each rAF tick handed the arc
a new target, restarting a fresh 150ms ease-out from wherever the previous one
had reached, so it never arrived anywhere — it just perpetually re-eased about
150ms behind the scroll. Transitions are for occasional state changes. On top
of that it re-rendered the component on every scroll frame, competing with
Lenis and GSAP for the same budget.

A spring is the right instrument because it is *re-targeted* rather than
restarted: velocity carries across updates, so a stream of positions at 60fps
resolves into one continuous movement. `lib/useScrollProgress.ts` gained
`useScrollProgressValue()`, the same measurement published as a MotionValue,
which Framer writes straight to the SVG node with no React render at all.
Deliberately not Framer's `useScroll`: it measures through `ResizeObserver`,
and one definition of "how far down are we" for the whole storefront is worth
more than the import it saves.

`scrollDial` in `lib/motion.ts` is overdamped (ratio 1.5) so the arc settles
onto the value without crossing it — this reports a quantity the reader can see
for themselves, and an indicator that wobbles past the truth is worse than one
that arrives a moment late. The first tuning was ratio 1.86, far enough
overdamped that it read as drag.

**Scrolling has two regimes and they cannot be scrolled the same way.**
`ScrollEngine` (Lenis + GSAP) is mounted by the homepage only, per §18. Lenis
runs its own rAF loop with its own idea of where the page is, so a bare
`window.scrollTo` moves the real position without telling it and the next frame
animates back from the value Lenis still believes is current — the page fights
you. Everywhere else, and on the homepage under `prefers-reduced-motion` where
Lenis is never started, native scrolling is correct.

`lib/scrollTo.ts` is a module-level registry rather than a global.
`ScrollEngine` already exposed `window.__lenis`, but only under
`NODE_ENV !== "production"` — that is a test seam for automated scroll checks,
not an API, and a control depending on it would have worked in development and
silently fought Lenis in production. Verified by spying on both routes: on `/`
the click calls `lenis.scrollTo(0, {immediate: false})` and `window.scrollTo`
is never called; on `/products/[slug]` it calls
`window.scrollTo({top: 0, behavior: "smooth"})` and there is no Lenis at all.

Under `prefers-reduced-motion` it jumps (`immediate: true`) and the arc's CSS
transition is dropped, so nothing on the control animates of its own accord.
The preference is read with `useSyncExternalStore` — the same choice §21 makes
for the bag, and for the same reason: a media query is genuinely an external
store, and seeding state from an effect is what
`react-hooks/set-state-in-effect` objects to.

Contrast was computed, not eyeballed, which changed the design. `ink-raised` on
`ink` is **1.13:1** — the surface alone gives the control no perceivable
boundary — so it carries a `bone/40` border at **3.58:1**, over the 3:1 that
WCAG 1.4.11 asks of a UI component. The chevron is 15.71:1 and the
`flare-orange-hot` arc is 5.99:1. The track ring is deliberately below 3:1: it
is decoration, the rule covers what identifies the component and its state, and
a track bright enough to pass would read as a completed ring and destroy the
only thing the arc exists to show.

It sits clear of `BottomNav` using the same `--bottom-nav-h` variable the shell
already pads with, so the two cannot drift apart, plus
`env(safe-area-inset-bottom)`. It unmounts rather than fading to `opacity-0`,
because an invisible button is still in the tab order.

### The skip link that was missing all along

Sixteen storefront pages render `<main id="main">`. Nothing had ever linked to
it, so a keyboard user tabbed the whole navbar, the search field and the
category row on every navigation.

Both this and the back-to-top mount once, in the root layout, via
`components/StorefrontChrome.tsx` — so a new route inherits them by existing
rather than by someone remembering to paste two components in, which is exactly
the failure that left `id="main"` orphaned for the life of the project.

`/admin` is excluded by a pathname check rather than an `app/(storefront)`
route group. The group is the textbook answer and would mean moving nine
top-level route directories to buy a test one line can do, with every move a
chance to break a static path. The check is honest about what it is: one
boundary, in one file, named after the thing it excludes.

`StorefrontChrome` sits *inside* `Providers` and first within it. Outside, the
back-to-top's entrance would have escaped `MotionConfig reducedMotion="user"`;
the three providers render context and no DOM, so nesting costs the skip link
nothing — it is still the first element in the document.

### On verifying scroll behaviour in this environment

Recorded because it will waste somebody's afternoon otherwise. The in-app
browser pane **never fires `requestAnimationFrame`** — measured, 0 ticks in
800ms, with `document.visibilityState === "visible"`. Both `useScrolled` and
`useScrollProgress` batch through rAF, and their `frame` guard latches on the
first scroll, so scroll-driven UI appears permanently dead there and Lenis
never advances. It is an artifact of the pane not compositing, not a bug in the
hooks: Lenis's `wrapper` defaults to `window` and its `setScroll` calls
`window.scrollTo`, so real scroll events and `window.scrollY` behave normally
in a real browser — which is what `lib/useScrollProgress.ts` has always
claimed and is, on inspection of Lenis's source, true.

The workaround is to patch `requestAnimationFrame` to a macrotask *before
hydration* and dispatch synthetic scroll events. Patching afterwards does not
work, because the latched `frame` id never clears.

**That workaround has a hard limit: it cannot verify anything Framer animates.**
Framer captures `requestAnimationFrame` when its module is evaluated, so its
render batcher is bound to the frozen native one before any patch can land —
MotionValues never flush to the DOM there, and the pane shows a dial stuck at
its initial value however much you scroll. This applies to every Framer
animation on the site, not just this control. Scroll-linked motion has to be
checked in a real browser; the pane can confirm structure, attributes,
contrast and event wiring, and nothing about how it moves.

## 30. Category counts are derived, and the stored field is gone

The homepage advertised **"TOPS — 38 ITEMS"**. Clicking it opened a page headed
"10 pieces", with a sidebar that also said 10. Reported from the storefront,
not found by a test.

### Every stored count was wrong

`Category.itemCount` was a hand-typed field, edited through a "Number of items"
input in `/admin`. Measured against the published catalogue:

| Category | Stored | Actual |
|---|---|---|
| Jackets | 24 | 12 |
| Parkas | 12 | 8 |
| Tops | 38 | 10 |
| Pants | 19 | 8 |
| Bags | 9 | 7 |
| Clothing | 0 | 38 |
| Accessories | 0 | 7 |

Not one was right. The two groups read 0 because a group holds no products of
its own, so nobody ever typed a number into them — while their *collection*
pages correctly showed 38 and 7, because that page counts.

### The justification had already stopped being true

§19 recorded the field as stored "because the homepage rows render without
loading the catalogue". `app/page.tsx` is a server component that reads the
entire content store, products included, and passes `homepage.categories.items`
straight into `CategoryList`. The catalogue was already in hand. The field
bought nothing and cost accuracy.

Two other places in the codebase had already worked this out and said so
without anyone joining the dots:

- `getCollectionLinks` in `lib/catalogue.ts`: *"Counts are computed here rather
  than read from `Category.itemCount`, which is a hand-typed field and drifts.
  A number sitting next to a grid the visitor can count themselves has to be
  right."*
- The admin field's own hint: *"Typed in by hand — the collection page counts
  products itself."*

So the disagreement was documented in two places and shipped anyway. Writing
down that a value is unreliable is not the same as removing the unreliable
value, and a comment explaining a defect will not stop anyone reading the
number.

### Removed, not corrected

Correcting the seven numbers would have reset the clock on the same drift — the
next product added puts them wrong again. So `itemCount` is deleted from the
`Category` type, the publish schema, the seed data, and the admin.

Counting now lives in `lib/categoryCounts.ts`, which is **client-safe** — no
`import "server-only"`. That is the point of it being a separate module from
`lib/catalogue.ts`: `/admin/categories` is a client component editing draft
state, and it has to show the same number computed from the draft's own
products. Server-only counting would have left the admin either duplicating the
logic or going without, and duplicating it is exactly how this bug happened.
Same split as `lib/mediaLimits.ts` and `lib/checkoutSchema.ts` — the rule is
shared, the I/O is not.

`productsIn(category, allCategories, products)` is the single definition of
"what is in this category", used by the collection page, its side nav, the
homepage rows and the admin. A grid and the number above it can no longer
disagree, because they are the same function call.

### Two things worth stealing from this

**The admin input is gone, not disabled.** An editable field that no longer
affects anything is worse than no field: staff would keep typing numbers into
it and reasonably expect them to appear. The live count is shown on the
categories list instead, where it is information rather than an invitation.

**`CountedCategory extends Category` is assignable to `Category`,** so
TypeScript would happily let a derived `count` ride from the list into the
editor, through `save`, and back into published content — quietly recreating
the stored field. `forEditing()` strips it on the way in. The publish schema
would also drop it, but only after it had been written to the draft, and a
draft carrying a phantom field is the beginning of the same problem.

### One contrast fix, in passing

The homepage row's count label was `text-bone/40` — **3.58:1** on `ink`, which
fails AA for text. It is `text-bone-faint` now: **6.12:1**, and the token
`tailwind.config.ts` describes for "labels, meta". Changed because the line was
being rewritten anyway; measured rather than eyeballed. It is one of the
over-faded `bone` tints the known-issues list warns about, and the pattern is
worth checking wherever `bone/40` or lower carries text.

## 31. Fixing `/data` does not fix a published site

The homepage's "Shop Series 026" button pointed at `/collections/series-026`,
which 404s. It was reported, fixed, recorded as resolved — and then reported
again, from the same button, still broken.

### Why the first fix did nothing

The fix changed `data/homepage.ts`. That file is the **seed**, not the content:

> `/data` is the store's *seed*: it supplies the content until something is
> published for the first time. — README

Something had been published. From that moment `.content/site.json` is what the
storefront reads and `/data` is never consulted again. So the repository was
correct, the commit was correct, DECISIONS said "resolved", and the running
site still served the dead link. Verified: the seed had
`/products/series-026-field-parka` while the published document still had
`/collections/series-026`.

This is the same shape as §30 — the published document disagreeing with what
the code implies — and the two turned up one after another. It is worth naming
as a category rather than a coincidence: **anything under `/data` is only ever
true of a fresh install.** A change there fixes nobody's running site,
including the developer's own.

Three things follow, and only the first is about this button:

- **Fix the content, not the seed.** Corrected in `.content/site.json` directly
  here; on a deployment it is an edit in `/admin` followed by a publish. Fixing
  the seed as well is still right — a fresh install should not start broken —
  but it is not the fix.
- **The dead URL now redirects.** `/collections/series-026` was live on a
  homepage for a while, so it exists in browser history, in anything that
  crawled the site, and in the published content of any deployment nobody has
  corrected yet. `next.config.mjs` sends it to the piece itself. Series 026 is a
  drop, not a category (§22), so no category was invented to satisfy the URL.
  Non-permanent, like the `/collections/all` rule beside it: a 301 is cached
  effectively for ever, and a real Series 026 collection page later would be
  unreachable for anyone who had followed it once.
- **`npm run content:check-links`** walks every internal `href` in the published
  content and reports the dead ones with the path they sit at
  (`homepage.brandStatement.cta.href`). It found this one when run against the
  pre-fix document and reports "all resolve" against the corrected one.

### Why a script and not a publish-time refusal

Publishing already refuses structurally invalid content — a category nested two
levels deep, for instance (§22) — so refusing a dead link would have precedent.
It is still the wrong call. An editor can legitimately point a link at a product
they are about to add, or stage a link and the page for it across two publishes,
and blocking that is worse than telling them afterwards. A dead internal link is
a defect to be found, not a corruption to be prevented.

The script reads through `contentStore`, so it checks whichever store is
configured — the JSON file or Postgres. That is what `import-content.ts` cannot
do: it reads `.content/site.json` itself to avoid the `server-only` guard, and
is therefore blind to a Postgres-backed store. This one runs under
`tsx --conditions=react-server`, which resolves that guard to a no-op — a node
resolution flag rather than an environment variable, so it works on Windows too.

### The honest limitation

It checks links **in content**. A dead `href` hard-coded in a component is
invisible to it, and so is a link whose target exists but renders an error. It
covers the case that has now bitten twice; it is not a crawler.

## 32. Crawlable surface: sitemap, robots, llms.txt, 404 and breadcrumbs

Phase 3 of the SEO pass. Four things the site had none of, plus one thing it had
two copies of.

### `lastModified` is a real timestamp or it is absent

The usual sitemap shortcut is `lastModified: new Date()` on every entry, which
claims the entire site changed at the moment of the fetch. It is not merely
useless — it is why crawlers learn to ignore the field.

Two real sources are used instead, and neither existed before:

- `ContentStore.publishedAt()` was added to the interface. The file adapter
  returns the document's mtime, the Postgres adapter returns `savedAt` on the
  published row. That is the moment an editor last pressed Publish, which is
  genuinely when every content-derived page last changed.
- Policy pages carry their own `updated` string — "Last updated 28 August 2026"
  — which is a date a human maintains and which the page itself displays. It is
  parsed, and an unparseable string yields no `lastModified` rather than a
  guess.

Verified distinct in the output: catalogue entries carry the publish time, and
`/returns` carries `2026-08-28T00:00:00.000Z`.

### The sitemap is the mirror of the `noindex` decisions

59 URLs: home, both listings, nine collections, two synthetic views, 45
products, four policy pages. Nothing that carries `noindex` in `lib/seo.ts`
appears. A sitemap that advertises a URL whose own metadata refuses indexing
hands a crawler two contradictory instructions about one page, and it is the
sitemap that looks wrong.

### `siteUrlIsPlaceholder`, and a lesson about when it is evaluated

`robots.ts` and `sitemap.ts` both refuse to emit absolute URLs when
`NEXT_PUBLIC_SITE_URL` is unset. A `Sitemap:` line pointing at
`http://localhost:3000` is worse than none: it is a live, cacheable instruction
that resolves to nothing, and a crawler cannot tell it from a real one.

Worth recording how that was verified, because the first attempt was wrong.
Setting the variable at `next start` did **not** produce a `Sitemap:` line —
`robots.ts` renders as a static route, `NEXT_PUBLIC_*` is inlined at build time,
so the guard had already fired during the build. The variable has to be present
when the site is *built*, not when it is served. The guard was working
correctly; the test was not.

### `llms.txt`, generated rather than written

Plural, per llmstxt.org; `/llm.txt` is a redirect so there is one document and
one URL that owns it.

Generated from the live content store for the same reason category counts are
derived (§30): a hand-written summary of a catalogue is a copy of the catalogue,
and it drifts. Every count, category name and price range in it is read at
request time.

It contains **no invented business facts** — no address, no GSTIN, no phone
number, no founding date. Those are exactly the details `data/policies.ts`
admits are placeholder, and a machine-readable file is the worst possible place
to launder them into something that reads as authoritative. It also states that
the policy copy is unreviewed, rather than presenting it as settled terms.

### The 404: a real status, and a framework limitation worth knowing

There was no `app/not-found.tsx` at all, so Next's default was shipping — an
unstyled white page on a site that is otherwise bone-on-ink, which reads as
"this site is broken" rather than "that page does not exist".

The replacement is built to be useful rather than decorative: a search box that
hands off to the real `/search`, the live categories with their real counts, and
routes back into the catalogue. It returns a genuine **404**, verified on three
paths — an unmatched URL, an unknown product, an unknown collection.

**But its body is not in the server-rendered HTML.** Measured: the response is
`<html id="__next_error__">` with an empty `<body>`, and the content arrives in
the flight payload for the client to render. A minimal `not-found.tsx`
containing nothing but an `<h1>` behaves identically, so this is Next 16.3.1's
behaviour and not something in this code.

The installed docs
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`)
document `global-not-found.js` as the routing-level alternative that returns a
full HTML document. **It was deliberately not enabled**, for three reasons in
increasing order of weight:

1. It is experimental in this version (`experimental.globalNotFound`, default
   false).
2. It bypasses the root layout, so the navbar, footer and global styles would
   have to be re-imported by hand — and the navbar and footer are most of what
   makes the page useful.
3. Decisively: it only covers **unmatched URLs**. A `notFound()` call from a
   matched route — `/products/nonexistent`, the more common case by far —
   still renders through `not-found.tsx` and would still be client-rendered.
   Enabling an experimental flag to fix half the cases is a bad trade.

The SEO cost is nil, which is why this is acceptable rather than a defect: the
response is a 404, and Next automatically injects `<meta name="robots"
content="noindex">` on it — confirmed in the output. A page that must not be
indexed does not need its body in the HTML. A human with JavaScript sees the
full page.

### Error boundaries existed nowhere

`app/error.tsx` and `app/global-error.tsx` were both absent, so any unhandled
runtime error showed Next's default screen with no route back into the site.

`error.tsx` is deliberately self-contained — no `Navbar`, no `Footer`, no
content-store read. It catches errors thrown by the very components it would
otherwise render, and a boundary that depends on what just failed is a boundary
that throws inside itself.

`global-error.tsx` is the only file in this codebase where hard-coded hex is
correct. It replaces `<html>` and `<body>`, which means it runs when the root
layout failed — so the stylesheet and font variables may never have been
applied, and a Tailwind class that resolves to nothing would render black on
white. The values match the `ink` and `bone` tokens and are duplicated on
purpose: this page is what is left when the design system is gone.

Both surface `error.digest` visibly. It is a hash, not a stack trace — nothing
leaks — and it matches a server log line exactly, which turns "it broke" into
something traceable.

### Breadcrumbs: one array, two outputs

The product and collection pages each hand-rolled their own trail markup; policy
pages had none. Adding `BreadcrumbList` JSON-LD to hand-rolled markup would have
created two independent descriptions of one trail, and Google's guidelines
require the markup to match what a person sees — a mismatch is a violation, not
a cosmetic bug.

`components/Breadcrumbs.tsx` takes one `trail` array and renders both the
visible `<ol>` and the JSON-LD from it, so they cannot diverge. Verified equal on
all three page types.

It is an ordered list rather than the loose spans it replaces: the order is the
meaning, and `<ol>` is what tells a screen reader "item 2 of 3" instead of
reading a run of unrelated links. The current page is marked `aria-current`.

### Internal links: measured, not asserted

A crawl of all 59 sitemap URLs plus the three private shell pages, collecting
every internal `href` from the rendered HTML:

**Zero orphans, and zero pages with only one inbound link.**

The one genuine gap it exposed was `/collections/new` and `/collections/sale`:
both are real, indexable, in the sitemap, and were reachable only from the
navbar — from the chrome rather than from any page *about* browsing. They now
have a "More ways in" block on `/collections`, which is the page a crawler
following "Collections" actually lands on.

## 33. Making a deploy survivable: DEPLOY.md and a pre-deploy gate

Phase 1 of getting this in front of a client. Nothing here changes what the
application does — it changes what happens when somebody tries to ship it.

### The check that existed but never ran

§31 built `content:check-links` and then said, in this file's own known-issues
list: *"It has to be remembered. It belongs in CI and in the pre-deploy
checklist; until it is there, a dead link still ships silently."*

That entry sat there while the tool it describes did nothing, which is the same
failure §31 was written about — knowing a thing is wrong is not the same as
making it impossible. So it is wired in two places now:

- `npm run predeploy` — ESLint plus the link check, one command to run before
  pushing.
- `vercel.json` sets `buildCommand` to `npm run predeploy && npm run build`, so
  **a Vercel deploy runs it whether anyone remembers or not** and a dead link
  fails the build instead of reaching a client.

`vercel.json` survives rather than being deleted when its `crons` block was
removed, and that is the reason: an empty config file is an invitation to put
crons back without reading why they went. Giving the file a job it is actually
doing is better than leaving a `{}` behind.

Note the asymmetry with §31's own reasoning, which is deliberate. That section
argued *against* refusing a **publish** for a dead link, because an editor can
legitimately link to a product they are about to add. A **deploy** is a
different moment: nothing is half-finished by design at the point you are
shipping to production, and the cost of being wrong is a client clicking a 404.
Publish stays permissive; deploy is a gate.

### DEPLOY.md exists because the failure modes are not guessable

`.env.local.example` is thorough and annotated, and it is the wrong document to
read at deploy time — it answers "what does this variable do", not "what is the
minimum, what should I deliberately leave unset, and what will bite me".

The three things it leads with are the three that actually go wrong:

**Turnstile fails closed on the admin, and open on the customer forms.** This is
the one that will lock you out in front of somebody. With `TURNSTILE_SECRET_KEY`
unset, `/admin/login` refuses *every* sign-in with correct credentials included
— verified in `app/admin/login/actions.ts`, which returns before the password is
ever checked. The customer forms do the opposite: `verifyTurnstileIfConfigured`
returns `{ ok: true, reason: "skipped-unconfigured" }`. Both behaviours are
right and §17 and §25 explain why, but the asymmetry is invisible unless
somebody tells you, so DEPLOY.md tells you, along with Cloudflare's
always-passing test pair as the way back in.

**`NEXT_PUBLIC_SITE_URL` is inlined at build time.** §32 records getting this
wrong during testing: setting it at `next start` did nothing, because the value
was baked when the site was built. Anyone deploying will hit the same thing —
and its symptom is an empty `sitemap.xml` and a `robots.txt` with no `Sitemap:`
line, which looks like the code is broken rather than like a missing variable.

**Uploads do not survive a deploy.** Documented at the point of deploying rather
than only in a known-issues list, because that is where somebody is standing
when it matters.

The rest is the release sequence, with `db:deploy` called out as something the
build does *not* do, and a smoke test whose steps each fail differently — a
cash-on-delivery checkout at the end because it exercises the database, the
order writer and the guest order link in one pass.

### The WhatsApp number, fixed in both copies

The footer's support link was `wa.me/919000000000` — a placeholder that looked
like a phone number, which is the worst kind. It is now the real support line.

Changed in **two** places, because §31 is the section that exists to stop this
being changed in one:

- `data/homepage.ts` — the seed. On its own this fixes a fresh install and
  nothing else.
- `.content/site.json` — the published document, which is what the storefront
  actually reads once anything has ever been published.

Verified by serving the built site and reading the link out of the rendered
HTML on two routes, rather than by grepping the source. That is the check that
would have caught the Series 026 button both times it was declared fixed.

**A deployed database is still not covered by this commit, and cannot be.** Any
environment whose content was published before today holds the old number in its
own `ContentDocument` row; correcting it is `/admin` → Pages → Homepage →
Footer, then Publish. Code in a repository cannot reach a database it is not
connected to, and pretending otherwise is exactly the mistake §31 records.

The number is a public-facing support line printed in the site footer, so
committing it is the intent rather than a leak — but it is a real contact
detail in a public repository, which is worth knowing before this is forked.

## 34. The pre-deploy gate could pass without checking anything

Two faults in the gate §33 added. The first is the serious one: the tool written
to stop §31 recurring could report green having never read the published
content.

A new section rather than an edit to §33, because §33's reasoning is still
correct and worth keeping legible — a gate belongs at deploy, publish stays
permissive, `vercel.json` earns its keep. What was wrong was not the argument
but two assumptions inside the implementation. Rewriting §33 in place would hide
that the design survived and only the mechanism failed.

### It read whatever the environment happened to give it

`scripts/check-links.ts` reads `contentStore`, and §31 says approvingly that it
therefore "checks whichever store is configured — the JSON file or Postgres".
True of the code. Not true in the way that matters, because **the store is
chosen from the environment at the moment the script runs**:

```ts
const driver =
  process.env.CONTENT_STORE_DRIVER ?? (process.env.DATABASE_URL ? "postgres" : "file");
```

No `DATABASE_URL` means `FileContentStore`. On a fresh Vercel checkout there is
no `.content/site.json` — it is gitignored — so `read()` catches ENOENT and
returns the `/data` seed. The check then validates the seed, prints "all
resolve", and exits 0.

Vercel keeps **build-time and runtime environment variables in separate
scopes**, and setting one and not the other is an ordinary mistake rather than
an exotic one. The result is a green link check on a document nobody read,
while the published content actually being served went unexamined. That is the
§31 failure exactly, reintroduced by the fix for it, and dressed in a passing
build. A silent pass is worse than no check: it converts "nobody looked" into
"somebody looked and it was fine".

### Refusing to be ambiguous

The script now asks `describeContentStore()` — added to `lib/contentStore.ts`,
which previously made this decision and then said nothing about it — and calls
`publishedAt()` before reading anything. That one call separates the two states
that look identical from outside: `null` means nothing has ever been published,
a real timestamp means there is a published document.

|  | Nothing published | Published document | Store unreachable |
|---|---|---|---|
| **postgres** | pass — seed *is* live, says so | pass — reports publish time | **fail**, checks nothing |
| **file**, inferred, local | pass — says it read the seed | pass | — |
| **file**, inferred, deploy | **fail** | pass | — |
| **file**, explicit | pass — operator declared it | pass | — |

The one genuinely new refusal is the third row. In a deploy context — `VERCEL`
or `CI` set — an inferred file store with nothing published means the check has
nothing authoritative to look at, and by far the likeliest explanation is the
missing build-scope variable. An operator who really is deploying a seed-only
site says so with `CONTENT_STORE_DRIVER=file`, which is a declaration rather
than an accident.

Every run now prints which store it read and what it found there, pass or fail.
A green check that does not say what it read is a green check nobody can act on,
which was the whole defect.

Proven rather than argued, with `.content/site.json` moved aside to simulate a
fresh checkout:

- deploy context, no `DATABASE_URL` → **exit 1**, naming the build-vs-runtime
  scope split
- same locally → exit 0, "the /data seed — nothing has been published, so the
  seed IS what gets served"
- deploy context with `CONTENT_STORE_DRIVER=file` → exit 0, `file (explicit)`
- `DATABASE_URL` pointed at a dead port → **exit 1**, "Nothing was checked"

### Lint and the link check are not the same kind of check

`predeploy` was `lint && content:check-links`, and `vercel.json` gated the build
on it. So one unused import could stop a deploy — at any hour, for something no
visitor could perceive.

They now have different severities, because they are different things. A dead
link is user-visible breakage and stays fatal everywhere. Lint is style, and its
severity depends on the target: **production strict, preview reported but not
blocking**. Local runs stay strict, since the relaxation is about unattended
builds rather than about the person deliberately running the gate.

That leaves a working escape hatch which is a *target* rather than a flag: push
to a preview and demo from that URL. Deliberately no `SKIP_CHECKS` variable — an
override wide enough to reach for in a hurry is one that disables the link check
too, and §33's point was that a check nobody is forced to run does not exist.

**Lint was not simply dropped, and the installed docs are why.** Per AGENTS.md,
checked rather than assumed: Next 16 **removed `next lint`** and the `eslint`
config option (`03-api-reference/05-config/03-eslint.md` — "Starting with
Next.js 16, `next lint` is removed"). `next build` therefore runs no ESLint at
all, and `npm run predeploy` is the only thing linting on any deploy. Dropping
it would have meant nothing lints, ever — the opposite of the intended
loosening.

TypeScript is unaffected either way. `next build` still type-checks and
`next.config.mjs` sets no `ignoreBuildErrors`, so real correctness stays gated
on every target no matter what lint does.

## 35. Dead code sweep, and the things that only looked dead

A pass with `knip` (unused exports, files, dependencies), TypeScript's
`--noUnusedLocals --noUnusedParameters --allowUnreachableCode false`, and
ESLint. Everything a tool flagged was cross-checked against real usage before
anything was deleted, which turned out to matter: **most of what was flagged was
alive**, and two of the flags were the kind that break a build if trusted.

### What was removed

Fifteen symbols, all verified unreferenced anywhere outside their own
definition:

| Removed | Where |
|---|---|
| `listOrphanedFiles` | `lib/mediaStore.ts` |
| `readAccountDataAction` | `app/account/actions.ts` |
| `revokeCurrentSessionAction`, `RevokeResult` | `app/admin/(dashboard)/security/actions.ts` |
| `emptyState` | `app/checkout/actions.ts` |
| `findMedia` | `components/admin/mediaLibrary.ts` |
| `getAllCollections` | `lib/catalogue.ts` |
| `springTap` | `lib/motion.ts` |
| `RATE_LIMIT_MAX_ATTEMPTS` | `lib/rateLimit.ts` |
| `SectionsIcon` | `components/admin/AdminIcons.tsx` |
| `RegisterInput`, `AddressInput` | `lib/auth/accountSchema.ts` |
| `PaymentMethodValue`, `CheckoutInput` | `lib/checkoutSchema.ts` |
| `export { cn }` | `components/admin/ProductDrawer.tsx` |
| `export { fadeUp, fadeUpSm }` | `components/ui/Reveal.tsx` |

Plus the five imports left dangling by those deletions, found by the strict
compiler pass rather than by eye.

Two are worth calling out because they were **protected by comments that were
not true** — the failure mode this ledger keeps recording:

- `emptyState` in `app/checkout/actions.ts`: *"Kept so this `"use server"`
  module exports only async functions."*
- `revokeCurrentSessionAction`: *"Kept exported so the module has no non-async
  exports — a `"use server"` rule."*

The rule is real. The claim that these satisfied it was not: every other export
in both modules is already an async function, so removing them changes nothing
about the constraint. Verified by deleting and building. A comment asserting
that code is load-bearing is not evidence that it is — §30 made the same point
about a number, §31 about a link, §34 about a check.

`export { cn }` was a component re-exporting a utility it had imported, and the
`fadeUp` re-export announced itself as a convenience "so sections don't need to
import from lib/motion too" — while every section imports from `lib/motion`
directly. A convenience nobody used is not a convenience.

### What looked dead and was left, deliberately

**Two would have broken the build.** Both are cases where a tool cannot see the
consumer:

- **`@prisma/client` reported as an unused dependency.** It is imported by the
  generated client (`@prisma/client/runtime/client`), which lives in
  `lib/generated` — correctly excluded from analysis, and therefore invisible.
  Removing it would break every database call in the app.
- **Six icons in `components/ui/Icons.tsx`** — `HomeIcon`, `ShopIcon`,
  `TruckIcon`, `ReturnIcon`, `RupeeIcon`, `ShieldIcon` — reported as unused
  exports. They are the values of the `trustIcons` and `bottomNavIcons` maps in
  the same file. Used, just not imported.

**Half-built features, left because the seam is the point.** These are unused
because the thing that would call them does not exist yet, and deleting them
would quietly delete a decision:

- `pruneAdminSessions`, `pruneExpiredSessions`, `pruneRateLimits` — garbage
  collection for three tables that grow without bound. There is no scheduler:
  §34 removed the only cron this project had, because Vercel's Hobby plan
  rejects it. These are the other half of that story. Deleting them would mean
  writing them again from scratch the day a cleanup job is added, and the
  reasoning about *what* is safe to prune (see the lockout-window comment in
  `pruneRateLimits`) would have to be rediscovered.
- `destroyAllCustomerSessions` — "sign out everywhere", which is what a password
  change is supposed to trigger. There is no password-change flow yet. The
  function is the seam that makes adding one safe.
- `isSecretBoxConfigured` — matches `isRazorpayConfigured`,
  `isShiprocketConfigured` and `isTurnstileConfigured`, all of which are used.
  An admin diagnostics surface would want all four. Left for the symmetry.

**Exported but used only inside their own module.** About twenty of these:
`checkRateLimit` / `recordFailure` / `clearAttempts` under their `*All`
wrappers, `signOrderToken` beside `verifyOrderToken`, `getToken` and `assignAwb`
in the Shiprocket client, `tokenise`, `clampDescription`, `backoffMs`,
`seedContent`, and the schema fragments in `lib/auth/accountSchema.ts` and
`lib/checkoutSchema.ts`.

Every one of these is live code. The only thing "unused" about them is the
`export` keyword, and un-exporting is a refactor of a module's API surface, not
a deletion of dead code — with no runtime benefit, since none of it ships to the
browser. A sweep whose purpose is removing what nothing references should not
quietly narrow the public shape of every library module on the way past. Listed
here so the next sweep does not re-litigate it.

`postcss-load-config` is reported as an unlisted dependency. It appears once, in
a JSDoc `@type` annotation in `postcss.config.mjs`, and resolves transitively.
Adding a dependency during a removal pass to satisfy a type comment is the wrong
trade.

### On the tooling

`knip` was run with a temporary config and **not** added to the project.
Reproducing the sweep is one command, and a config file describing this
repository's entry points would itself become something to keep true — the exact
maintenance burden §30 and §31 are about. The strict TypeScript pass is the part
worth keeping in muscle memory:

```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --allowUnreachableCode false
```

It is clean across the repository as of this change, and it needs no
configuration to stay that way.

## 36. Uploads that survive a deploy, and the 4.5 MB nobody can raise

The last item in "Blocking a real launch". Two faults, and they compound: photos
uploaded on Vercel were lost on the next deploy, and photos large enough to be
worth keeping never arrived in the first place.

### A silent success is the worst failure

`lib/mediaStore.ts` hardcoded `new FileMediaStore()`, writing to
`.content/uploads/`. On Vercel that filesystem is ephemeral, so the upload
**succeeds** — the picker shows the tile, the manifest updates, the admin gets a
green result — and the file is gone at the next deploy. Nobody finds out for
weeks, and by then the original is on somebody's phone or nowhere.

That is worse than a failed upload in every way that matters. A failure is
information; this was a lie with a delay on it.

### `BlobMediaStore`, selected the way the content store is

Vercel Blob, chosen over S3 or R2 because it needs no second account: creating a
store in the project's Storage tab sets `BLOB_READ_WRITE_TOKEN`, which is also
the variable the adapter is selected by — the same inference `selectStore()`
makes from `DATABASE_URL`, with `MEDIA_STORE_DRIVER` as the explicit override.
The file adapter stays the default for local development.

`MediaStore`, `app/media/[id]/route.ts` and every admin component are unchanged.
Uploads still stream through our own `/media/<id>` route rather than a Blob CDN
URL; that costs a hop and buys an unchanged interface, an unchanged id format,
and no way for storage URLs to leak into published content.

Blob's `list()` returns pathname, size and uploadedAt but **not** intrinsic width
and height, and `ImageAsset` requires those. So the adapter keeps a manifest
blob, mirroring the file adapter's `manifest.json`, and `MediaItem` means the
same thing under both. The same last-writer-wins race applies to two
simultaneous uploads; it is not new, the admin is single-operator, and fixing it
properly means a row rather than a JSON document.

### Answering "which media store is this?" — §34 applied again

§34 added `describeContentStore()` after a build-time check passed green having
read the wrong thing. Media has the identical shape with a worse consequence, so
it gets the identical treatment: `describeMediaStore()` reports the driver, where
it points, whether it was inferred or declared, and — new here — a `problem`
field.

`problem` is non-null only for states that cannot work:

| Environment | Driver | Problem |
|---|---|---|
| local, no token | `file` (inferred) | none |
| **`VERCEL=1`, no token** | `file` (inferred) | **flagged** |
| token present | `blob` (inferred) | none |
| `VERCEL=1` + token | `blob` (inferred) | none |
| `MEDIA_STORE_DRIVER=blob`, no token | `blob` (explicit) | **flagged** |

The second row is the one that mattered. It is flagged whether or not the driver
was explicit, because nobody deliberately wants uploads that disappear — unlike
the content store, where an explicit `CONTENT_STORE_DRIVER=file` is a legitimate
declaration.

And it is not merely reported. `assertMediaStoreUsable()` runs in `uploadMedia`
**before** the write, throwing a typed `MediaStoreConfigError` that the action
passes through verbatim instead of its generic "couldn't save that image, please
try again". A misconfiguration is not transient, and telling somebody to retry
sends them round a loop that cannot succeed. The message names the variable to
set, and it appears in the error UI the picker already had — so the silent data
loss became a visible refusal without touching a single admin component.

### The 4.5 MB limit, and why downscaling rather than a presigned upload

Verified against Vercel's live docs (`/docs/functions/limitations`, checked
2026-09-03) rather than taken on trust:

> The maximum payload size for the request body or the response body of a Vercel
> Function is **4.5 MB**. If a Vercel Function receives a payload in excess of
> the limit it will return an error 413: `FUNCTION_PAYLOAD_TOO_LARGE`.

It is a platform limit. `serverActions.bodySizeLimit: "16mb"` in
`next.config.mjs` cannot raise it, and the comment there implying that number was
the ceiling is now corrected. An ordinary phone photo is 3–8 MB, so it died in
transport, before any application code ran, with a platform error rather than the
friendly message `processUpload` already had ready.

**The deciding fact was that the server already throws the data away.**
`processUpload` resizes to `MAX_DIMENSION = 2400` and re-encodes to WebP quality
82. Every pixel past 2400 and every byte of the original encoding is discarded on
arrival — today, before any of this. Sending a 12-megapixel original spends
megabytes of somebody's mobile connection on information the pipeline deletes.

So `lib/downscaleImage.ts` shrinks the image in the browser to the *same* 2400px
the server would have. This is not a workaround that happens to help; it is the
correct behaviour, and the platform limit only made the existing waste visible.

The alternative — a presigned direct-to-Blob upload — raises the ceiling and
costs three things worth more than the ceiling:

- **It bypasses `processUpload`, which is a security control.** That function
  decodes the bytes, rejects anything that is not a supported raster image, and
  re-encodes so that nothing of the original container or its EXIF survives to be
  served from our own origin. Preserving it behind a direct upload means
  re-fetching every file from storage and reprocessing it, with a window where an
  unvalidated file is already in the bucket.
- **It only works on one platform.** The file adapter has no 4.5 MB problem, so
  the browser would need two upload paths chosen by environment — precisely the
  divergence §34 exists to prevent.
- Its `onUploadCompleted` callback cannot reach `localhost`, so local development
  would need a tunnel.

The honest cost: the server never sees the original pixels. For a storefront
catalogue that is what was already happening one hop later.

Three details in the implementation are load-bearing:

- **It never throws.** Every failure path returns the original file, because the
  existing size check and `processUpload` still run and can produce a message the
  operator can act on. A browser that cannot decode an image is not a reason to
  refuse the upload here.
- **`imageOrientation: "from-image"`** when decoding. Without it a portrait phone
  photo is re-encoded in its stored landscape orientation while the EXIF tag is
  dropped with the original container — arriving permanently on its side.
  `sharp`'s `.rotate()` does the same job on the un-downscaled path.
- **Files under 3 MB are sent untouched**, and a re-encode that came out larger is
  discarded. Neither gains anything, and both would cost a little quality.

`CLIENT_MAX_DIMENSION` and `MAX_DIMENSION` are the same number in two files that
cannot import each other — `processUpload` pulls in `sharp`, which must never
reach the browser. Both now carry a comment saying to change them together. It is
the kind of duplication this ledger keeps recording as a source of drift, and
naming it is the only defence available short of a shared client-safe constants
module for one number.

## 37. The policy pages stop pretending to be a real shop's terms

`data/policies.ts` presented invented compliance details as a real store's
binding terms: a registered address, GST registration referenced on "every
invoice", a named grievance officer, an eight-year retention period, and the
courts of Mumbai holding jurisdiction. There was a notice admitting the copy was
placeholder — below the title, in muted text, after the reader had already
started reading the page as terms.

### Inventing a delivery estimate is not the same as inventing a GST number

The old framing treated all of it as one category — "plausible but unreviewed".
It is two.

"Mumbai and Pune: one to two days" is a description of how a shop like this
would operate. It is illustrative, the notice now frames it as illustrative, and
demonstrating a storefront means demonstrating that a shipping page has delivery
estimates on it.

"Our registered address and GST details appear on every invoice" is a **false
statement about a legal registration**, on a page headed Terms of Service. So is
a named grievance officer, which Indian consumer rules specifically require a
real store to publish. These read as true precisely *because* the rest of the
page is careful — the care is what lends them credibility.

So the operational copy stays and the compliance claims are gone. Where one
stood, the text now says what a real store would put there:

> A real store would identify its operating entity here: the registered company
> name, its registered address, and its tax registration details.

That demonstrates the shape, which was the point of the pages, without asserting
anything untrue. Jurisdiction went with the registered address for the same
reason — which courts have jurisdiction follows from where a business is
actually registered, and this one is not.

### The notice is a component, not a field

`PolicyPage` in `data/types.ts` has no field for this and one was not added.
Three reasons:

- **It is a fact about the site, not about any one policy.** Four identical
  copies in a data file is four things to keep in step, which is the drift
  §30 recorded for a count and §31 for a link.
- A per-page field reads as *editable per page*, inviting somebody to reword it
  on one and drop it from another. It is not that kind of text.
- It is also needed on `/checkout`, which is not a `PolicyPage` at all, so a
  field on that type could never have served both callers.

`components/DemoNotice.tsx` holds both variants in one file so the wording
cannot drift between them.

### Markup and colour, both deliberate

The previous notice was an `<aside role="note">`. A complementary landmark is
exactly what some screen-reader reading modes skip, which is the wrong property
for the one paragraph on the page that must not be missed. The replacement is
ordinary flow content with real `<p>` elements, read in order with everything
else.

It sits **above** the `<h1>`, which is also why its emphasised first line is a
`<p><strong>` rather than a heading: an `<h2>` before the page's `<h1>` would
create the heading-order violation already tracked against `/products`.

Colour was measured rather than chosen. `bone` on solid `flare-red` is 5.41:1
and on the 10% tint 16.95:1, but `flare-red-hot` **text** on that tint is only
3.78:1 and fails AA — so the red carries the surface and bone carries every
word. The 2px solid `flare-red` border is 3.28:1 against the page, over the 3:1
WCAG 1.4.11 asks of a boundary.

### Checkout gets the short version

Checkout is the one page where somebody can type a real address and a real phone
number into a form, so the warning arrives above the form rather than beside it.
Two lines in the page's own voice — deliberately not a modal, which people
dismiss reflexively and which would be the wrong register for a demonstration
anyway.

### On the seed-versus-published trap

Checked before relying on it, because §31 exists: `SiteContent` is
`{ homepage, collectionPage, products }` and nothing else. Policies are not in
it, `.content/site.json` has no policy key, and
`app/(policies)/[slug]/page.tsx` imports `@/data/policies` directly — as do
`app/sitemap.ts` and `app/llms.txt/route.ts`. So editing `data/policies.ts`
changes the live site, and this is one of the few content changes where the
`/admin` publish step is not also required.

## 38. A gate that runs before the build cannot depend on the build

The first production deploy failed, and not on anything the environment tables
in `DEPLOY.md` describe. `npm run predeploy` died at `MODULE_NOT_FOUND` with a
require stack four files deep:

```
lib/db.ts → lib/prismaContentStore.ts → lib/contentStore.ts → scripts/check-links.ts
```

`lib/db.ts` imports `@/lib/generated/prisma/client`. That directory is written
by `prisma generate`, which lives inside `npm run build` — and `vercel.json`
runs `npm run predeploy && npm run build`. The gate ran before the thing that
produces what the gate imports.

### Why it could only appear on a clean checkout

`/lib/generated/` is gitignored, so it does not arrive with a clone; it arrives
the first time somebody builds. Every machine that has ever run `npm run build`
therefore has it sitting there, and the ordering bug is completely invisible —
`npm run predeploy` passes locally, has always passed locally, and will keep
passing locally. Vercel clones fresh every time, so it broke on the first
deploy and would have broken on every deploy.

This is the second time this project has shipped a defect that only exists in
the state the author's machine never occupies. §31 was a link fixed in the seed
while the published document stayed broken. This is a module present everywhere
except where it matters. Both are the same shape: **local state standing in for
a fact about the deployment.**

### The eager import is what makes it unconditional

`lib/contentStore.ts` imports `PrismaContentStore` at the top level, not inside
the `selectStore()` branch that chooses a driver. So the Postgres adapter — and
through it `lib/db.ts`, and through that the generated client — loads for
*every* driver. The failure is not "the link check needs a database"; it is
"the link check cannot be loaded without a build artifact", which happens with
or without `DATABASE_URL`, with or without a published document.

Left as an eager import deliberately. Making it lazy would fix this symptom by
narrowing the blast radius rather than by fixing the ordering, and would leave
the next thing that imports `lib/db.ts` before a build to rediscover it.

### Where the fix belongs

Three candidates, and the choice is about which invariant is being restored.

- **`vercel.json`'s `buildCommand`.** Smallest change, and wrong. It fixes the
  Vercel path and leaves `npm run predeploy` broken on a clean clone anywhere
  else — CI, a colleague's laptop, anyone following `DEPLOY.md` §5. The gate is
  documented as runnable on its own; it has to actually be runnable on its own.
- **`postinstall`.** Prisma's usual recommendation, and it would work here. But
  it trades one external ordering assumption for another: it assumes install
  ran *with scripts enabled*, and `npm ci --ignore-scripts` is ordinary in
  hardened CI. That is the same class of bug, one step removed.
- **`scripts/predeploy.mjs` itself** — chosen. The gate generates its own
  prerequisite before running any check, so it depends on nothing but the
  checkout. Fatal if generation fails, for the §34 reason: a check that could
  not run must never report a pass.

### What it costs

`prisma generate` runs twice per deploy — once in the gate, once inside
`npm run build`. It is idempotent and took 120ms on the verifying run.

The only way to avoid the duplication would be to remove it from `build`, which
would leave `npm run build` unable to stand on its own for anyone who runs it
directly, including a Vercel build with no `buildCommand` override. Paying the
duplicated generate is the cheaper side of that trade by a wide margin.

Generation needs no database, which is what makes it safe to put in front of
everything: `prisma.config.ts` omits the datasource entirely when no URL is
set, precisely so that generating a client never requires one.

### The general rule this adds

§33 introduced the gate and §34 hardened what it reports, and neither noticed
the import chain underneath it. The rule that was missing:

> **A check that runs before the build must not import anything the build
> produces.** Anything `scripts/predeploy.mjs` reaches, directly or through a
> chain, has to exist in a fresh clone — or the gate has to make it exist
> first.

Verified the way it should have been the first time: `rm -rf lib/generated`
reproduces the exact require stack from the Vercel log, and the same command
passes after the fix.

## 39. Drafts are a second document, on the server

`ContentStore` grew `readDraft()`, `writeDraft()` and `clearDraft()`, a
`DraftRecord` type, and two server actions (`saveDraft`, `discardDraft`). Both
adapters implement them. §15 and §16 describe the state before this and are
amended above.

### The problem was not only losing a refresh

Edits lived in React state and nowhere else, so a refresh, a closed tab or a
dropped connection destroyed them silently. That is the obvious half.

The half that actually decided this: **the only way to keep work was Publish**,
and Publish puts it on the live site. Someone half-way through rewriting the
hero, not ready for anyone to see it, had no safe option at all — either leave
the tab open indefinitely and hope, or push unfinished copy to production. A
content manager whose only save button is "make this public" is not a content
manager.

### Separate from the published document, not a flag on it

The storefront reads published content on every request. A draft must not be
able to affect it even briefly — not while a validation runs, not for the
milliseconds between two writes. Keeping both in one document with a flag would
make that a matter of everyone remembering to filter; keeping them in separate
documents makes it structural. Nothing that reads published content can see a
draft, because it is not there.

It is a **whole `SiteContent`, not a diff against published.** That is inherited
rather than argued: `read()` and `write()` already move the entire document
(§15, and §24 for why the Postgres adapter stores it whole in one column), so a
draft is the same object in a different place, and every consumer already knows
that shape. A diff would also need a base to apply against, and the base is
precisely the thing that moves when somebody publishes — a stored diff can go
stale against content it no longer describes, which a whole document cannot.

### Two schemas, built once

Drafts validate against `draftContentSchema`, publishes against
`siteContentSchema`, and `lib/contentSchema.ts` builds both from one
`build(strict)` function rather than maintaining two.

**A draft is checked for shape, not for completeness.** Someone who has cleared
a headline in order to retype it has an empty required field for as long as it
takes to type the next one, and refusing to save at that moment would destroy
exactly the work autosave exists to protect. Cross-field rules are publish-only
for the same reason: a draft caught mid-reorder can legitimately reference a
product that has not been added back yet.

What stays refused in both: wrong types, invalid enum values, missing sections.
Those are not work in progress, they are a broken payload, and storing one means
the next load restores something the admin cannot render.

The single `build()` is what keeps the two honest. Two hand-written schemas
would drift the first time a field was added to one.

### Autosave, and the second it cannot cover

One second after typing stops, keyed off the dirty flag — so *opening* the admin
never writes a draft, only a real edit does. Per keystroke would be pointless
traffic and a race between responses arriving out of order.

There is also an explicit "Save draft" button, because a debounce is invisible
and some people want to know.

`beforeunload` covers the one gap the debounce leaves: the second between the
last keystroke and the timer firing. It is registered only while there is
genuinely unsaved work, so it never interrupts someone who is simply leaving.

### Discard kept its ref, and grew a second half

§15 recorded that `discard()` restores the last published baseline from a ref.
**That is still true and still what happens locally** — `baseline.current` is
unchanged, and resetting to it rather than to `/data` is still what stops a
discard reverting live content to the seed.

What changed is that local state is no longer the only place the work lives.
Clearing React state alone would leave the saved draft on the server, and the
next page load would restore the very changes just thrown away — a discard
button that undoes itself on refresh. So `discard()` now also calls
`discardDraft()`.

Publish clears the draft too, for the milder version of the same reason: the
draft has *become* the published content, and leaving it would greet the next
visit with an unpublished-changes banner describing work that is already live.

### Restoring, and computing what changed

The dashboard layout reads published content, media and any draft in one
`Promise.all`, and a leftover draft wins as the starting state. That is the
point of saving one: the editor returns to what they were working on, not to
what the site currently shows.

**The dirty flags are recomputed, not stored.** Each section of the restored
draft is compared against the published document, and only the ones that differ
are marked. Storing the flags in the draft would mean trusting a record of what
changed instead of the change itself, and the two can disagree. Recomputing also
means the banner can name the sections — "Hero, Products" rather than an
unhelpful "you have unsaved changes".

### What stayed in the provider

`AdminDraftProvider` is still the live editing state, and no editor component
changed. What moved to the server is durability, not editing: every keystroke
still lands in React state first and the UI never waits on a round trip. The
provider gained four values (`draftStatus`, `draftSavedAt`, `saveDraftNow`,
`restoredDraft`) and no consumer was forced to care about any of them.

### The two adapters, including where they differ

`FileContentStore` writes `draft.json` beside `site.json`, through the same
temp-file-then-rename as the published document — the path is derived from
`dirname(STORE_PATH)`, so `CONTENT_STORE_PATH` moves both and they cannot end up
in different directories. `PrismaContentStore` uses the same `ContentDocument`
table under the key `"draft"`, and clears with `deleteMany` so discarding a
draft that is already gone is a no-op rather than a record-not-found error.

Worth noting for the §15 seam claim: **drafts predate Postgres.** The Prisma
adapter was written after this and implemented the draft methods from its first
commit, so there was never a version of it that lacked them.

One asymmetry, deliberate on one side and unexamined on the other:
`FileContentStore.readDraft()` returns `null` on *any* error, not just `ENOENT`.
That is right for a corrupt draft — published content is intact regardless, and
throwing would lock the admin out of the dashboard entirely over a file nobody
needs. But it also swallows a genuine I/O error, and the Postgres adapter does
not do the equivalent: a database failure there propagates. The two therefore
behave differently when the store is broken rather than merely empty.

### Two editors can clobber each other, and nothing stops them

`writeDraft` is an unconditional overwrite. There is no version, no timestamp
precondition, no compare-and-set. Last writer wins, silently.

That is not as theoretical as the single-admin model (§17) makes it sound.
There is one set of credentials, but §25 added a Security page that *lists
concurrent sessions*, because signing in from a second browser or a phone is
ordinary. Two of those editing at once is one draft, and whichever autosave
fires last is the one that survives — the other person's paragraph disappears
under them with no error and no indication it ever existed. Autosave makes it
likelier rather than less, because neither editor has to press anything for it
to happen.

**Unresolved, and recorded rather than fixed.** The shape of a fix is not hard —
`writeDraft` takes the `savedAt` the client last saw, refuses when the stored
one is newer, and the admin surfaces the conflict — but it needs a real answer
for what the losing editor is then shown, and inventing a merge UI for a
single-operator tool is out of proportion to the risk today. It is listed under
Known issues → Correctness and security.

### Publish promotes and clears in two calls, not one

`contentStore.write(next)` and `contentStore.clearDraft()` are separate
operations with no transaction around them, in both adapters. A failure between
them leaves the published content correct and a stale draft behind, so the admin
reopens announcing unpublished changes that are in fact already live.

Cosmetic rather than dangerous — the content served is right, and pressing
Discard resolves it — which is why it was left. Recorded because the symptom
("it says I have unsaved changes and I don't") reads like a bug in the banner,
and whoever chases it should know where to look.

## 40. Per-section drafts, and the whole-document check that makes them safe

> **Nothing in this section is implemented.** Every other section in this file
> records something that was built; this one records a design and the reasoning
> behind it, so that whoever builds it does not rediscover the problems from
> scratch. If you are reading the code and it does not match what is below, the
> code is right and this is still a plan. The draft mechanism that actually
> exists today is §39: one whole-document draft, one Publish button.

### What it is for

Two things §39 ends on, both unresolved there:

- **Concurrent editors clobber each other silently** (§39, "Two editors can
  clobber each other"). `writeDraft` is an unconditional overwrite.
- **Publish is all-or-nothing.** A half-rewritten hero sitting in the draft
  blocks an urgent price correction, because there is one document and one
  button and publishing sends everything.

The second is the one that will be felt first. Someone will need to change a
price on a Friday and discover that doing so also publishes a paragraph they
were still arguing about.

### A section is the screen that already exists

The unit is not a new structure. `/admin` already puts each homepage section on
its own route — Hero, Lookbook, Brand Statement, Product Rail, Trust Strip,
Navigation, Footer are separate screens (§16), one per key of
`HomepageContent`. Products are edited one at a time in a drawer that is
remounted per product (§16 again), so **one product is one section**.

Taking the existing screen as the unit matters more than it sounds. An editor's
mental model of "the thing I am working on" is already the page they are
looking at, so a per-section draft, a per-section dirty flag and a per-section
Publish all describe something they can already see. A unit invented for the
storage layer — per top-level key, per field, per changed subtree — would need
explaining, and the explanation would be a lie about how the tool is used.

### The three parts

**1. Drafts split per section.** Instead of one `draft` document holding the
whole `SiteContent`, one draft per section, keyed by the section it belongs to.
An edit to the hero writes the hero's draft and touches nothing else.

**2. Publish per section — but validated whole.** This is the part that is easy
to get wrong and the reason the design is worth writing down rather than
"obvious". Publishing a section does **not** mean writing that section's draft
over that section of published content and stopping. It means: assemble the
document *as it would be* — this section's draft merged over the currently
published document — and run the full strict `siteContentSchema` over the
result. If the assembled document fails, refuse the publish and say which rule
broke and where.

The section being published is the only thing that changes, but the whole
document is what gets checked. Anything less cannot see the failures below.

**3. A "changed elsewhere" check.** `writeDraft` takes the `savedAt` the client
last saw and refuses when the stored one is newer, surfacing the conflict
instead of overwriting. This is §39's proposed fix, unchanged.

### The two problems that make part 2 non-negotiable

Both are cases where per-section machinery, however careful, cannot see the
breakage — which is the entire argument for validating the assembled whole.

**a) Sections reference each other.** `ProductRailContent` stores `productIds`,
not products. So: delete a product in the Products section, publish only that
section, and the still-published Product Rail now points at an id that resolves
to nothing. **The two edits never touched the same section**, so no
per-section lock, no per-section version check and no per-section validation
catches it. Only a check that assembles both halves and looks at them together
does — which is exactly what the existing publish schema already does with its
cross-field `superRefine` (§15), and exactly what is lost the moment publishing
becomes partial without it.

**b) Publish order matters.** Removing a product properly is two changes: take
it off the rail, then delete the product. Do them in that order and the site is
correct at every moment. Do them in the other order and there is a window —
however long it takes to press the second button, which may be a lunch break —
where the live site advertises a product that does not exist.

One Publish button cannot get this wrong, because there is no order to get
wrong. Two can. **Partial publishing does not just add a feature, it introduces
a sequencing hazard that does not exist today**, and part 2 is what makes the
hazard a refusal rather than a broken page: publishing the delete first fails
validation, naming the rail that still references it.

Worth stating plainly, because it is the cost side of this design: per-section
publishing makes the *ordinary* case better and the *careless* case worse, and
only the whole-document check keeps the careless case from reaching visitors.

### No locks, and why the obvious design was rejected

The reflex answer to concurrent editing is a lock: claim a section while
someone is editing it, release it when they leave. Rejected.

**Per-section drafts already prevent the common collision.** Two devices
working on different sections write to different places and never meet. What a
lock adds is coverage of the narrower case — both devices on the *same*
section — and part 3 handles that for a fraction of the cost, by detecting the
conflict at write time rather than preventing it in advance.

What rejecting locks removes:

- **Lease expiry.** A lock held by a browser that was closed without releasing
  it has to time out, so now there is a duration to choose, a heartbeat to keep
  it alive while someone is genuinely still typing, and a section that is
  unavailable for however long the lease outlives the tab.
- **A takeover path.** Because the expiry above will sometimes be wrong, there
  has to be a way to seize a stale claim — which is a second, more dangerous
  code path that exists solely to undo the first one.
- **A message that would be actively confusing here.** "Someone else is editing
  this section" is nonsense in this codebase: there is **one admin identity**
  (§17 — a username and a password in the environment, not an accounts system),
  so every concurrent session is the same person. The honest message would be
  "you are editing this on another device", and a system whose main output is
  telling you about yourself is not earning its complexity.

The general shape: a lock prevents a conflict that per-section drafts have
mostly already prevented, at the price of three mechanisms that can each fail
in their own way. Detection at write time is smaller and its failure mode is a
message rather than a stuck section.

### Open questions, not yet answered

- **What the preview shows when other sections have unpublished drafts.**
  Including them means an editor approves a page assembled from work that is
  not going live with it — they sign off on something no visitor will see.
  Excluding them means the preview is of a page that exists nowhere, because
  the drafts *are* where the work is. Both are wrong in different directions
  and there is no third option that is obviously right.
- **Published content becomes a patchwork.** Assembled from many small
  publishes at many different times, so "put it back to how it was yesterday"
  stops being one step and becomes a question about which sections. There is
  no rollback today, so this is a cost incurred *later*, by whoever builds one
  — but it will be harder to build then than it would be now, and that is the
  kind of thing this file exists to say out loud.
- **Draft keys are tied to section names.** Renaming a homepage section, or
  adding one, means stored draft keys that no longer match the schema. Needs
  either a reader tolerant of unknown and missing keys — the same instinct as
  `withDefaults` (§20) — or a migration. Tolerant is almost certainly right,
  because a draft is disposable in a way published content is not.

### Deliberately not built yet

**Variants and stock come first.** That is a sequencing decision, not a
scheduling accident, and the reason is which cost grows.

Every feature built against a product that has one price and no size makes
variants more expensive to add later: the checkout, the order snapshot, the
bag, the courier push and the `Offer` structured data on the product page all
currently assume one price per product — and the last of those additionally
hard-codes `availability: InStock`, which is only honest while nothing has
stock. That debt compounds with every commit. **This
design's cost does not** — per-section drafts are exactly as hard to build in
six months as they are today, because nothing else in the codebase is
accumulating assumptions about there being one draft document.

So this waits, and the thing whose price is rising gets built.

**Part 3 is the exception, and is worth doing alone if the pain arrives first.**
The `savedAt` precondition works against the *current* whole-document draft with
no restructuring at all — it is a parameter on `writeDraft`, a comparison, and a
message in the admin. It is a stepping stone rather than throwaway work: the
same check, unchanged, is part 3 of this design. If someone loses an afternoon's
work to a silent overwrite before the rest of this is built, that is the piece
to build in response.

## 41. Variants live in the content document, and stock does not

Products gained sizes on the `variants-stage-1-2` branch: the data model in
`7bc4559`, the size picker in `fd020e2`. Until this section, the reasoning
existed only in code comments — the exact gap §39 was written to close, one
feature later. §19 is the precedent: it recorded `categoryId`, the last field
added to `data/types.ts`. `variants` is the next.

### A field on the product, not a table

`Product.variants: ProductVariant[]` — a size, a SKU, and an optional per-size
price. There is no variants table, and the reason is the catalogue itself:
`prisma/schema.prisma` opens by saying it "lives in the content store, not in
its own table", and a bag line, a saved item and an order resolve a product id
against that document when rendered (§15, §24). A variants table would put
half of one product in a JSON document and half in Postgres, joined by a
string with no foreign key, and every publish would have to reconcile the two.

Worth being honest about how this was settled: the field shape was specified
in the brief for the work, and no table design was prototyped against it. It
follows from the content-document model rather than beating an alternative in
a comparison.

### No `stock` field, on purpose

This is the most important decision in the model, and the comment on
`ProductVariant` in `data/types.ts` is where the argument lives.

The content document is read, modified and written back **whole** on every
publish (§15, §39). A stock count inside it would be decremented by checkout
with a read-modify-write, which races two concurrent checkouts. The worse
failure needs no concurrency at all: an editor opens `/admin`, spends twenty
minutes on the hero, and presses Publish — writing back every stock count as it
stood when they loaded the page, and silently undoing every sale made since. A
count needs an atomic decrement, and a JSON column holding the entire catalogue
cannot give it one.

So stock belongs in Postgres, keyed by SKU. **That table does not exist yet.**

### `lib/stock.ts` is a seam, and "in stock" is currently true

`stockStatus(variants)` is server-only and async, and returns an explicit
status for every SKU rather than a list of the sold-out ones.

- **Server-only and async** because stock will live in a database the browser
  cannot reach. Availability is answered on the server and handed down as
  props; being async already means the query can be added without every caller
  gaining an `await`.
- **Every SKU, explicitly**, because once this is a query a SKU missing from
  the result must mean something decided in one place, not something each
  caller infers from absence.
- **Always `"in-stock"` today, and that is honest rather than optimistic.**
  There is no stock anywhere, so nothing can be sold out. The sold-out
  rendering was built and driven from this function, and verified by
  temporarily marking one SKU sold out; the stage that adds stock replaces the
  body and nothing that calls it changes.

One caveat that was reasoned, not tested: product pages prerender when no
database is configured (§26, §28), so availability computed here would be
baked in at build time. It becomes request-time only because `DATABASE_URL`
makes the pages dynamic — the coupling §28 warns about. The stage that adds
stock should declare the page's rendering mode rather than inherit it.

### SKUs are stored, generated, and not the first word

`makeSku` builds `VNT-<product code>-<size>`, and the result is **stored** on
the variant, not computed at render time. A SKU is handed to people outside this
codebase — a courier, a warehouse, an invoice — and an identifier that changed
because somebody improved the function would be worse than one that is merely
ugly. Storing it is also what lets an editor override one later. For the same
reason the seed carries all 175 variants as literals rather than calling the
function: generated once, checked, and frozen.

The brief's example was `VNT-APX-M` — a code from the first word alone. **Run
against the real 45 product ids, a first-word-only code produced nine
collisions.** Four products start with `grid`; `vector-storm-shell` and
`vector-cargo-pant` share every letter such a code would use. No function of
the first word can separate them. `productCode` therefore takes the first
word's consonant skeleton, adds the initial of every later word, and keeps any
word containing a digit whole — `apex-technical-shell` is `APXTS`,
`series-026-field-parka` is `SRS026FP`. That rule was chosen by running
candidates against the catalogue, and it has no collisions across all 45, at
four to eight characters.

**Collision-free is a fact about today's ids, not a guarantee.** A future
`vector-storm-shield` would produce the same code as `vector-storm-shell`. The
function makes the common case right; the schema is what enforces uniqueness.

### Uniqueness is a whole-document rule

SKU uniqueness is checked in the `superRefine` block of `lib/contentSchema.ts`
— the publish-time, cross-field rules — and not on the variant schema. A
variant, or a product, cannot see any other product's SKUs, and uniqueness
checked inside one product would pass two products that both sell
`VNT-APXTS-M`. SKUs are compared trimmed and uppercased: `vnt-apxts-m` is the
same SKU as `VNT-APXTS-M` to a scanner, which does not distinguish case.

The same block requires sizes to be unique within a product, compared the same
way — "m" and "M" are one size to a shopper. On the field itself, publishing
requires at least one size and a positive per-size price when one is set.
Drafts check shape only (§39): a size list being rebuilt is empty for a moment,
and refusing to save it then would lose the work autosave exists to protect.

Measured, and easy to get wrong: a document with **no `variants` key at all**
does not fail on "Needs at least one size." It fails earlier, on the type —
`Invalid input: expected array, received undefined` — and it fails in the draft
schema too, because a missing field is a shape error. The pre-variant published
document on this machine produced 45 of those, one per product, in both.

### Sizes by category; prices by size

Sizes are not chosen per product. `SIZE_SETS` in `lib/variants.ts` is the only
place they are defined, keyed by category id: jackets, parkas and tops share
S–XL, pants run 28–38 by waist, bags are One Size. A product has one
`categoryId` (§19), so its sizes follow from where it is filed and nobody has
to remember that trousers are sized differently. Two limits follow from keying
on category ids, which are data: the groups (`clothing`, `accessories` — §22)
have no size set, and neither does a category an editor creates in `/admin`
until one is added in code.

Prices, by contrast, may vary by size. `ProductVariant.price` is optional, in
whole rupees like `Product.price`, and omitted when it matches — which is every
size of every product today. Whether prices differ is answered in exactly one
place, `priceSummary`, used by the product page, every product card, the meta
description and the structured data. It compares what sizes actually cost, not
whether they carry a price field, and "From" appears only when they genuinely
differ: "From ₹8,999" when every size costs ₹8,999 sends people hunting for a
cheaper size that does not exist.

### `variantsOf()` tolerates documents from before sizes — temporarily

`Product.variants` is required by the type, but a published document written
before this work has no such key, and reading it directly returns `undefined`.
§31 is why that is not hypothetical: the seed gaining variants changes nothing
about a document already published. `variantsOf()` returns an empty list
instead, and a product with no variants behaves exactly as it did before —
no picker, one price, Add to Bag enabled. It is the one place that tolerance
lives.

It is not meant to stay. On this machine the gap was closed by copying each
product's `variants` from the seed onto the published document, matched by id:
all 45 ids matched, the result passed the strict schema, and the admin edits in
that document survived. That was done by a throwaway script and imported with
`npm run content:import`; neither the script nor the merged document is in the
repository. Production is reported to have no published row at all, so it
serves the seed, which already carries variants — reported by the operator and
not verified from here.

**The `?? []` can be removed only once no environment holds a published or
draft document without variants**, checked per environment rather than assumed
— and it has to go before the bag starts carrying a SKU, because from then on
"no variants" can no longer mean "behave as before".

### The size picker is a set of radio buttons

`components/product/SizePicker.tsx` is `role="radiogroup"`, named by the
visible "Size" label, with one `role="radio"` button per size and its state in
`aria-checked`. It uses a roving tabindex: the group is a single Tab stop — the
chosen size, or the first available one — and Tab lands there without choosing
anything. Arrow keys, Home and End move between sizes and choose as they go.
Nothing is pre-selected on a multi-size product, because pre-picking M is how
somebody buys the wrong size; a one-size product renders no picker at all.

Sold-out sizes are shown, dimmed and crossed out, and marked `aria-disabled`
rather than `disabled`. A natively disabled button leaves the tab order and is
skipped by screen readers in browse mode; `aria-disabled` keeps it reachable so
it can announce itself. Arrow keys skip them, as the radio-group pattern
specifies. "Sold out" is appended as `sr-only` text, following §11. Add to Bag
takes the same approach: it is `aria-disabled` with a visible "Select a size"
reason, and pressing it moves focus to the picker.

Three things are worth recording as they actually happened:

- **Buttons with ARIA roles, not native radio inputs.** The stated reason is
  hydration — a native radio clicked between the HTML arriving and React
  hydrating would show as chosen while React still believes nothing is. That
  was reasoned, not reproduced.
- **Space and Enter are handled in the component** rather than left to the
  button's native activation. The comment gives the design reason, and it is a
  fair one; it was also added after the in-app browser used for verification
  could not trigger native button activation at all.
- **Not everything could be verified here.** Tab-without-choosing, Enter,
  arrow keys, skipping a sold-out size, a blocked click moving focus, and
  wrapping at 320px were all exercised in the browser. Space could not be sent
  end to end — the automation delivered it with an empty key — and the
  sold-out size's computed accessible name could not be read, because the
  tool's name computation is demonstrably not Chrome's. Home and End were not
  exercised. Both unverified behaviours deserve one pass with a real keyboard
  and a real screen reader.

### What is still owed

- **The bag carries no size.** A shopper chooses one, and Add to Bag adds the
  product: a bag line is `{ id, qty }`. `OrderItem` has no size or SKU column,
  so carrying a size through checkout needs a migration, and
  `lib/shipping/courierPush.ts` sends the product id as the courier's `sku`.
- **The product page's structured data is only partly variant-aware.**
  `availability` already reads `lib/stock.ts`, and when sizes cost different
  amounts the offer is already an `AggregateOffer` with `lowPrice` and
  `highPrice`. What remains: `sku` is still the product slug, and the
  `AggregateOffer` branch has never been observed rendered — structured data
  is suppressed locally because the site URL is a placeholder, and no product
  has varying prices.
- **There is no stock table.** `lib/stock.ts` says everything is in stock
  because nothing else can be true yet.
- **A product created in `/admin` cannot be published.** The drawer's blank
  product has `variants: []`, and publishing requires at least one size. There
  is no size editor.
- **`variantsOf()`'s tolerance**, until the condition above is met.

## Known issues / follow-ups

Every entry below was re-checked against the code on 2026-09-08. (The date read
2026-08-31 for some time after that had stopped being true: §30–§38 were all
written later, and the "Deploy-time documentation accuracy" block below is
itself headed 2026-09-03. A staleness date that is stale is the one field in
this list that cannot be allowed to drift, since it is what the rest of it is
trusted on.) Resolved items
are struck through with a pointer to the section that resolved them rather than
deleted, so the history of what was once wrong stays readable. **If you are
picking this project up, this list is meant to be trustworthy — if you find an
entry that no longer matches the code, fix the entry in the same change.**

### Blocking a real launch

- **The policy pages are illustrative, and the site says so.** §37 removed the
  part that was actually dangerous: the invented registered address, GST
  references, named grievance officer, retention period and jurisdiction — false
  statements about legal registrations, presented as a real shop's binding
  terms. Every policy page and `/checkout` now carry an unmissable notice above
  the title saying VANTA is fictional, nothing is for sale, and no real details
  should be entered.

  What remains before this could take money is not a copy edit. A real store
  needs: a registered operating entity, its address and tax registration; a
  named grievance officer with contact details, which Indian consumer rules
  require; a retention period set by the rules it actually operates under; a
  stated governing law and jurisdiction; and all of it reviewed by somebody
  qualified. The pages mark each of those places with a sentence saying what
  belongs there, so the shape is a checklist rather than a blank.

  **The notice comes out at the same time as those go in, and not before** —
  it is the only thing currently making the pages honest.
- **No refund path.** Razorpay takes money (§27) but nothing gives it back. A
  refund today is a manual action in their dashboard, and `REFUNDED` is a status
  nothing sets. Needs their Refunds API, a reason, and a decision about partial
  refunds that the order model does not yet express.
- **No order confirmation email.** Nothing is sent when an order is placed. The
  order page says so and tells the customer to keep the page rather than
  promising a message that will never arrive — but a guest who loses the signed
  link has no way back to their order. §26 explains why that link is signed
  rather than expiring.
- **Razorpay's webhook payload shape is unverified.** §27: the Orders API and
  the signature scheme were read from their live docs, but the pages describing
  payload nesting 404'd. `readWebhookFacts` reads several plausible paths and
  answers 422 rather than 200 on anything it cannot parse, so a mismatch is
  loud rather than silent — but it has not been tested against a real event.
  Send one test webhook before going live.

  §29 widened this: the same function now also reads `notes.orderNumber` and
  `receipt`, which are the recovery path for an unmapped payment. If the
  nesting guess is wrong, that recovery silently never fires — it degrades to
  the old behaviour rather than breaking, which makes a real test event more
  valuable, not less. Confirm both the entity nesting **and** that `notes`
  comes back on the payment entity.
- **The bag does not carry a size.** The product page asks for one (§41) and
  then discards it: a bag line is `{ id, qty }`, `OrderItem` has no size or SKU
  column, and the courier push sends the product id as the `sku`. An order
  placed today cannot say which size to ship. Needs a bag line keyed by SKU, a
  migration adding the size and SKU to `OrderItem`, and the variant SKU in
  `lib/shipping/courierPush.ts`.

### Correctness and security

- **No two-factor on the admin.** Deliberately not half-built. TOTP itself is
  small, but the admin identity is a pair of environment variables rather than a
  row — so an enrolled secret, its recovery codes and an "is 2FA on" flag have
  nowhere to live without inventing an admin-user table, which changes what
  `ADMIN_USERNAME` means and reopens §17's whole model. It also needs an
  enrolment screen, a QR encoder (a new dependency), hashed recovery codes, a
  second step in the login flow, and a documented way back in for someone who
  has lost their phone — that last part being the one usually skipped, and the
  only reason the rest of it matters. Worth doing as its own change, with the
  admin becoming a real row first.
- **The rate-limit key is only as trustworthy as the proxy.** It comes from
  `x-forwarded-for` / `x-real-ip`, which anyone can send unless the deployment
  guarantees a trusted proxy overwrites them. Vercel does; another host may not.
  Moving the counter into Postgres (§25) did not make the identity behind it
  more trustworthy — see §17.
- **Middleware cannot see a revoked session, and that is structural.** It runs
  on the Edge and must not open a database connection, so it checks the token's
  signature only. §28 records the redirect loop this caused and the
  `/admin/signed-out` route that breaks it. The residual cost is that a revoked
  browser takes one extra hop to reach the login form. Anything that adds a new
  redirect into `/admin` should be checked against that loop.
- **`SECRET_ENCRYPTION_KEY` is optional, and unset means no token cache.** §28.
  Safe by default — it never falls back to writing a plaintext credential — but
  a deployment that forgets it logs in to Shiprocket on every cold start, which
  their rate limiter will eventually notice. Set it in production.
- **Concurrent editors silently clobber each other's draft.** `writeDraft` is an
  unconditional overwrite — no version, no timestamp precondition, no
  compare-and-set — so whichever autosave lands last wins and the other
  editor's work disappears with no error and no trace. Autosave makes this
  *more* likely, not less, because neither person has to press anything for it
  to happen. Not theoretical despite the single-admin model (§17): §25's
  Security page exists precisely because signing in from a second browser or a
  phone is ordinary, and it lists those sessions. Shape of a fix: `writeDraft`
  takes the `savedAt` the client last saw and refuses when the stored one is
  newer. Blocked on deciding what the losing editor is then shown — a merge UI
  for a single-operator tool is out of proportion, and silently discarding
  their work is the bug being fixed. §39.

  **§40 designs the way out of this** — per-section drafts, so the common
  collision cannot happen at all, with the `savedAt` check above as its third
  part for the same-section case. **Nothing in §40 is built.** It also explains
  why that check is worth doing on its own, against today's whole-document
  draft, if this starts costing somebody real work before the rest exists.
- **`FileContentStore.readDraft()` returns null on *any* error, not just
  `ENOENT`.** A genuine I/O failure is therefore indistinguishable from "there
  is no draft", and the editor is quietly handed published content instead of
  the work they left. `PrismaContentStore` propagates instead, so the two
  adapters behave differently when the store is broken rather than merely
  empty. The file-adapter behaviour is *right* for a corrupt draft — published
  content is intact regardless and throwing would lock the admin out of the
  dashboard entirely — so what needs deciding is the asymmetry, not that
  branch. §39.

### Content and data

- **Product imagery is heavily reused.** There are 5 photos in `public/images`
  (3 model shots, 2 product shots) serving a catalogue of 45 products, so most
  products share an image with several others. Swap in real photography through
  `/admin` → Photos, or `data/products.ts` for the seed — no component changes
  needed.
- **Search matches names, categories and descriptions, not attributes.** There
  is no colour, size or material field on a product, so "black" only finds the
  handful whose alt text happens to say it. The generated catalogue describes
  shape ("technical shell jacket") rather than colour. Better alt text — or real
  attribute fields — is what makes those searches work.
- **Shipping is quoted but never charged.** Every order stores `shipping: 0`.
  The pincode check (§27) shows Shiprocket's rate for the cheapest courier, but
  that number is display-only. Charging it needs a policy (free over a
  threshold? flat rate? pass-through?) and, once there is one, it has to be
  priced server-side in `priceBag` like everything else — never taken from the
  browser.
- **Publish promotes and clears the draft in two calls, with no transaction.**
  `contentStore.write(next)` and `contentStore.clearDraft()` are separate
  operations in both adapters, so a failure between them leaves correct
  published content and a stale draft behind. The admin then reopens announcing
  unpublished changes that are in fact already live. Cosmetic — what is served
  is right, and pressing Discard resolves it — but the symptom ("it says I have
  unsaved changes and I don't") reads like a bug in the banner, which is the
  wrong place to go looking. §39.
- **Product structured data is only partly variant-aware.** `availability`
  already reads `lib/stock.ts`, and a product whose sizes cost different amounts
  already gets an `AggregateOffer` with `lowPrice` and `highPrice`. Two things
  remain: `sku` is the product slug rather than a variant SKU, and the
  `AggregateOffer` branch has never been seen rendered — structured data is
  omitted locally because the site URL is a placeholder, and no product has
  varying prices. Check it once on a deployment with a real site URL and a
  product priced by size. §41.
- **`variantsOf()` treats a product with no `variants` as having none.** That
  keeps a published document from before sizes rendering as it always did, and
  it is temporary. Remove the `?? []` only once no environment holds a published
  or draft document without variants — checked per environment, not assumed —
  and before the bag carries a SKU, after which "no variants" can no longer mean
  "behave as before". §41.

### Performance

- **LCP is still render-delay bound — the §13 server/client refactor did not fix
  it.** Render delay medians moved 2254ms (n=1 baseline) → 1727ms / 1902ms
  across two 5-run batches, but individual runs span 1685–2442ms, so the
  baseline sits *inside* the post-refactor range and **the improvement is not
  demonstrated.** LCP and Performance stayed flat within noise.

  The reason the win didn't materialise: client JS only went 183.0 → 181.1 KB.
  Framer Motion is still imported by `components/ui/Reveal.tsx` and so by every
  reveal leaf, so the library — the bulk of the bundle and of the hydration cost
  — never left the critical path. Scroll reveal has since been removed from the
  listing grids, which reduces how many pages pay for it but not the homepage.

  **The remaining lever is dropping Framer Motion from the scroll-reveal path**,
  replacing `Reveal`/`RevealGroup`/`RevealItem` with an IntersectionObserver +
  CSS-class approach (or `animation-timeline: view()` where supported). That
  would leave the library to the genuinely interactive pieces (`Navbar`,
  `CategoryRow`, `LookbookRail`, `PillButton`, `AddToBagButton`, `SaveButton`).
  Only attempt this with a **committed before/after baseline**.
- **Lighthouse scores here are very noisy.** Four 5-run batches across two
  builds gave Performance medians of 96, 94, 95, 94 with individual runs
  spanning 87–99 and LCP 2.27–3.92s. Treat anything under ~4 points as noise,
  always compare medians of ≥5 runs, and **commit before starting perf work** so
  a true before/after baseline can be measured on demand.

- **Over-faded `bone` tints carrying text.** §30 fixed one (`text-bone/40` on
  the homepage category rows, 3.58:1, failing AA) but did not sweep for the
  rest. Anything at `bone/40` or lower rendering text is a likely failure
  against `ink`; `bone-faint` is 6.12:1 and is the token meant for that job.
  Worth a pass with axe at a real viewport width — several of these sit behind
  `sm:`/`md:` breakpoints and are skipped by an audit run at a narrow one.
- **`/products` has a `heading-order` violation.** Product cards render an
  `<h3>` under an `<h1>` with no `<h2>` between. Measured with axe during §29:
  it is the only violation on `/`, `/products` and `/products/[slug]`, and it
  predates that work. Fixing it means deciding whether the grid needs a real
  section heading or the card should drop to a `<p>` with the link as the
  accessible name.
- **A payment against a CANCELLED order needs a human.** §29 leaves that event
  unprocessed on purpose — no retry can resolve it — so it sits in the
  reconciliation queue on `/admin/orders` until somebody issues a refund. There
  is no refund path yet (see above), so today that means doing it in Razorpay's
  dashboard and there is nothing in the admin that records having done so.

### Deliberately unused, kept as seams

Recorded by §35 so a future dead-code sweep does not delete them. Each is unused
because the thing that would call it has not been built, not because it is
residue.

- **`pruneAdminSessions`, `pruneExpiredSessions`, `pruneRateLimits`** — garbage
  collection for three tables that grow without bound. Nothing schedules them;
  §34 removed the project's only cron because Hobby rejects it. Wire them to a
  cleanup job when there is a scheduler.
- **`destroyAllCustomerSessions`** — "sign out everywhere". Waiting on a
  password-change flow, which does not exist.
- **`isSecretBoxConfigured`** — the fourth of four `is*Configured` predicates;
  the other three are used. An admin diagnostics view would want all four.

### Cosmetic

- **The hero renders two `<h1>` elements** — `components/Hero.tsx` renders
  `HeroHeadline` (which is `as="h1"`) twice, once for the mobile overlay and
  once for desktop, toggled with `lg:hidden` / `hidden lg:block`. Only one is
  ever in the accessibility tree since `display: none` removes the other, so
  this is not an a11y defect, but it is duplication worth collapsing if the two
  layouts ever converge.

### Deploy-time documentation accuracy — opened 2026-09-03

Found while walking through the first Vercel deploy. None of these break the
build; all three would mislead the next person doing a deploy.

- **`DEPLOY.md` §2 tells you to set a control Vercel does not have.** Lines 22,
  160, 162 and 179 say `DATABASE_URL` "must be set in the BUILD environment,
  not only at runtime" and that Vercel keeps build and runtime variables in
  "separate scopes". Checked against Vercel's live docs: the only scoping axis
  is Production / Preview / Development, and a variable scoped to an
  environment is available to that deployment **both during the build step and
  at runtime**. `Sensitive`/`Secret` typing does not change this either — those
  values are present during builds, which is why Vercel redacts them from build
  *logs*. The advice happens to produce the right action, but a reader will
  hunt for a checkbox that does not exist. Rewrite §2 around the real axis.
- **`scripts/check-links.ts` repeats the same claim** in its `§34` header
  ("Build-time and runtime environment variables are separate scopes"). The
  guard beneath it is correct and still catches the real failure; only the
  sentence explaining why is wrong. Fix the comment, not the code.
- **The real failure mode is environment scope, and it hits Preview.** Vercel
  Marketplace resources (Neon is one) can be set to **Production only**, which
  per Vercel's changelog "removes non-production access" and Preview
  connections "are removed". A Preview build then runs with `DATABASE_URL`
  unset, `selectStore()` silently returns the file adapter, and the link check
  fails with `driver: file (inferred — DATABASE_URL is not set here)` — which
  is exactly what §34 was written to catch, arriving by a different route than
  the comment predicts. Scope `DATABASE_URL` to **Preview as well as
  Production**, or accept that branch builds fail.
- **`DEPLOY.md` §5 says to run migrations but never says how the URL reaches
  the shell**, and the obvious way is the wrong one. On Windows, PSReadLine
  appends every interactive line to
  `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`,
  and its default sensitive-command filter matches `password`, `token`,
  `secret`, `apikey` — none of which appear in `DIRECT_DATABASE_URL`. So
  `$env:DIRECT_DATABASE_URL = '<url>'` writes a live credential to a plaintext
  file that outlives the terminal. Document the `Read-Host -AsSecureString`
  form in §5 so the value is never a command-line argument in the first place;
  it is shell-history-proof on every platform, unlike remembering to scrub.

### Resolved

- ~~Images are unoptimised PNGs~~ — **resolved**, §12. Converted to WebP at
  rest; served assets went 6.39 MB → 0.23 MB.
- ~~Admin rate limiting is in-memory and resets on restart~~ — **resolved**,
  §25. `lib/rateLimit.ts` is backed by Postgres, keyed by IP and identifier
  separately, with exponential backoff. The spoofable-header caveat above is the
  part that survived.
- ~~Bag state is a local stub: `BagProvider` holds an in-memory count seeded to
  2~~ — **resolved**, §21 and §24. It is a real bag in `localStorage` via
  `useSyncExternalStore`, mirrored to Postgres for signed-in customers.
- ~~Bag and wishlist are browser-local, so they do not follow a shopper between
  devices~~ — **resolved**, §24. `localStorage` remains the store for signed-out
  visitors, which is correct; signed-in customers get `BagLine` / `WishlistItem`
  rows reconciled by `components/AccountSync.tsx`.
- ~~No checkout — the bag's checkout control is deliberately inert~~ —
  **resolved**, §26. `/checkout` and `/orders/[orderNumber]` are real, COD works
  end to end, and §27 added online payment.
- ~~`/bag` and `/wishlist` do not exist~~ — **resolved**, §21. Both are real
  pages.
- ~~The footer's `/privacy`, `/returns`, `/shipping` and `/terms` 404~~ —
  **resolved**, §23-era work. All four render from `data/policies.ts` through
  `app/(policies)/[slug]`. The *content* is still placeholder — see above.
- ~~Nav links point at `/collections/series-026`, which does not exist~~ —
  **resolved twice, properly the second time.** Series 026 is a drop, not a
  category, so the link points at the piece itself
  (`/products/series-026-field-parka`) rather than a category being invented
  for it. The first fix changed only the `/data` seed and left the published
  content untouched, so the button stayed dead on every running site including
  this one — §31. The published document is corrected, the old URL redirects,
  and `npm run content:check-links` now catches the class.
- ~~There are no migrations; `prisma db push` was used, so `npm run db:deploy`
  has nothing to apply~~ — **resolved**, §28. `prisma/migrations/` now holds a
  baseline verified to apply cleanly to an empty database with zero drift.
- ~~WhatsApp support link is a placeholder (`wa.me/919000000000`)~~ —
  **resolved**, §33. Replaced with the real support number in *both* places §31
  says have to move together: the `/data` seed and the published document. Any
  deployment whose content was published before this still carries the old
  number and must be corrected in `/admin` → Pages → Homepage → Footer, then
  published — code cannot reach a database it is not connected to.
- ~~Uploaded images still need a writable disk~~ — **resolved**, §36. A
  `BlobMediaStore` adapter is selected from `BLOB_READ_WRITE_TOKEN` the way the
  content store is selected from `DATABASE_URL`, with the file adapter still the
  default locally. The combination that used to lose files silently — the file
  adapter on Vercel — is now refused before the write, with a message naming the
  variable to set.
- ~~A phone photo dies in transport on Vercel's 4.5 MB body limit~~ —
  **resolved**, §36. Images are downscaled in the browser to the same 2400px
  `processUpload` already resized them to, so nothing is lost and a normal photo
  arrives well under the platform limit.
- ~~`npm run content:check-links` is not wired into anything~~ — **resolved**,
  §33. It is `npm run predeploy` (with ESLint), and `vercel.json` sets
  `buildCommand` to run it, so a dead link now fails the build instead of
  reaching a client.
- ~~The Shiprocket bearer token is stored in plaintext~~ — **resolved**, §28.
  Encrypted at rest with AES-256-GCM under `SECRET_ENCRYPTION_KEY`.
- ~~Signing out of the admin leaves the cookie in place and loops~~ —
  **resolved**, §28.
