# VANTA

Homepage for VANTA — a men's technical streetwear brand based in Mumbai.
Dark editorial aesthetic, mobile-first, built to feel fast on Indian mobile
networks.

## Stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript**
- **Tailwind CSS 3** for styling
- **Framer Motion 11** for animation
- **next/font** — Archivo 900 (display), Playfair Display Italic 400 (accent),
  Inter variable (body). Each family loads **only the weights actually
  rendered**; adding a weight to `app/fonts.ts` adds a font file to the critical
  path, so add one only when something really uses it.

Requires **Node 20.9+** (see `.nvmrc`).

## Getting started

```bash
npm install
```

Copy the example env file and fill in real values — `/admin` won't let you in
without them:

```bash
cp .env.local.example .env.local
```

| Variable | What it's for |
|---|---|
| `ADMIN_USERNAME` | Username for signing in at `/admin/login` |
| `ADMIN_PASSWORD` | Password for signing in. Use something long and random. |
| `ADMIN_SESSION_SECRET` | Signs the admin session cookie. **Must be ≥32 characters** — the app throws on startup if it isn't. |
| `NEXT_PUBLIC_SITE_URL` | The site's public address, used to build share-preview links. Optional in development and on Vercel; **required elsewhere before launch**, or WhatsApp and search previews point at the wrong host. No trailing slash. |
| `DATABASE_URL` | Postgres, **pooled** connection string. Powers customer accounts, sessions, saved bags and the address book. Optional — the site runs without it. |
| `DIRECT_DATABASE_URL` | The unpooled connection, used only by `prisma migrate`. Optional locally. |
| `CONTENT_STORE_DRIVER` | `postgres` or `file`. Defaults to `postgres` when `DATABASE_URL` is set. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key. Public — it is rendered into the page. |
| `TURNSTILE_SECRET_KEY` | Turnstile secret key. **Never prefix this `NEXT_PUBLIC_`** — that would inline it into the browser bundle. Customer forms skip the captcha when it is unset; **`/admin/login` refuses to sign anyone in.** |

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`.env.local` is gitignored and must never be committed. Changing
`ADMIN_SESSION_SECRET` signs everyone out immediately.

```bash
npm run dev
```

Then open http://localhost:3000.

| Script | Does |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (flat config, `eslint.config.mjs`) |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply pending migrations (what a deploy runs) |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run content:import` | Copy `.content/site.json` into Postgres, once |
| `npm run content:check-links` | Report dead internal links in the published content |
| `npm run predeploy` | Lint + link check. Run before deploying; `vercel.json` runs it too |

## Project structure

```
app/          Routes, root layout, global styles, font definitions
components/   UI components — presentational, render whatever data they're given
  hero/       Hero's client leaves (headline reveal, copy fade)
  ui/         Shared primitives (Headline, PillButton, Reveal, Icons)
data/         All site content as typed objects — the single source of truth
lib/          Utilities: motion variants, formatters, hooks
  auth/       Customer passwords, sessions, and the saved bag/wishlist
  generated/  Prisma client — generated, gitignored, never edited
prisma/       Database schema and migrations
public/       Served static assets — images here are WebP only
assets-src/   Original full-size source images, never served
```

### Server vs client components

**Section components are server components. Only the bits that actually animate
are client components** — wrap server-rendered markup in `Reveal`,
`RevealGroup`, or `RevealItem` from `components/ui/Reveal.tsx` rather than
putting `"use client"` at the top of a section.

```tsx
// Server section — no "use client"
<RevealGroup className="...">
  {items.map((item) => (
    <RevealItem key={item.id}>
      <Card item={item} />   {/* also a server component */}
    </RevealItem>
  ))}
</RevealGroup>
```

`RevealItem` intentionally has no scroll trigger of its own — it inherits the
group's, which is what produces the stagger. Importing from `lib/motion.ts`
doesn't force a component client-side; only rendering a `motion.*` element does.
Full rationale and the current server/client split are in `DECISIONS.md` §13.

### Adding an image

**From the admin:** every image field has an **Upload photo** button. The file is
converted to WebP, capped at 2400px on its longest edge, stripped of metadata,
and served from `/media/<id>`. Uploads are saved immediately — they do not wait
for "Publish changes".

Where the bytes land depends on the adapter, selected the same way the content
store is: `BLOB_READ_WRITE_TOKEN` present → Vercel Blob, absent → the local
`.content/uploads/` directory, with `MEDIA_STORE_DRIVER=file|blob` overriding
either way. The file adapter is the default for local development. On Vercel it
cannot work — the filesystem is ephemeral — so an upload there is **refused
before the write** with a message naming the variable to set, rather than
succeeding and losing the file at the next deploy. See `DECISIONS.md` §36.

**As a committed asset** (for imagery that should live in the repo):
`/public/images` is WebP-only. Convert first, keep the original in
`/assets-src/images`, then reference the `.webp` from `/data`:

```bash
npx sharp-cli --input assets-src/images/new-shot.png --output public/images/ --format webp --quality 82
```

The two are deliberately separate. `/public` is a curated, build-time asset
directory; uploads are runtime data and stay out of it.

## Editing content

**All copy, imagery, products, and links live in `/data`.** You should not need
to touch a component to change what the homepage says.

- [`data/homepage.ts`](data/homepage.ts) — every homepage section: nav, hero,
  lookbook, brand statement, product rail, trust strip, categories, footer
- [`data/products.ts`](data/products.ts) — product catalogue (prices in whole
  rupees; formatting happens at render time)
- [`data/categories.ts`](data/categories.ts) — category rows
- [`data/types.ts`](data/types.ts) — the schema everything above conforms to

Two conventions are worth knowing before you edit:

**Headlines are structured, not strings.** A headline is a list of lines, each a
list of segments. Mark a segment `accent: true` to render it in the italic
serif:

```ts
headline: [
  [{ text: "MADE " }, { text: "to move.", accent: true }],
  [{ text: "BUILT " }, { text: "to", accent: true }, { text: " STAND OUT." }],
]
```

**Backdrops are named moods, not colours.** Set `backdrop` to `"red"`,
`"orange"`, `"sunset"`, or `"graphite"`; the component maps it to the right
gradient. Don't put hex values in `/data`.

## Design tokens

Defined in [`tailwind.config.ts`](tailwind.config.ts):

| Token | Value | Use |
|---|---|---|
| `ink` | `#0D0D0D` | Page background (plus `soft` / `raised` / `line` tones) |
| `bone` | `#F5F5F0` | Foreground text (plus `dim` / `faint`) |
| `flare-red` / `flare-orange` | `#C41E1E` / `#E8590C` | Photo backdrops only — never flat UI chrome |

The **storefront** additionally runs a scroll-driven layer — GSAP ScrollTrigger
scenes over Lenis smooth scroll (pinned hero, parallax, a scroll-linked camera
move, and an environment morph). It is mounted by the storefront page only and
is **deliberately absent from `/admin`**, where smooth-scroll hijacking would
fight forms and drawers. See `DECISIONS.md` §18.

Motion tokens (easings, durations, variants) live in
[`lib/motion.ts`](lib/motion.ts). Use them rather than writing inline
transitions — see `DECISIONS.md` §2.

Much of the palette is off-white at reduced opacity over near-black. **Measure
contrast before introducing a new muted tone below ~40% opacity** — see
`DECISIONS.md` §10 for the current measured values and why.

## Checkout and orders

`/checkout` collects an address and places an order; `/orders/<orderNumber>`
shows it. Reasoning is in `DECISIONS.md` §26.

**Payments and delivery are built** — see the next section. Cash on delivery
creates a `CONFIRMED` order; "Pay online" writes a `PENDING_PAYMENT` order and
only Razorpay's webhook moves it on. Every order still stores `shipping: 0`:
the pincode check quotes a courier rate for display, but what a customer is
actually charged needs a policy that doesn't exist yet.

**An order snapshots what was bought.** Title, price and image are copied at
purchase time and never re-read from the catalogue. This is the opposite of the
bag, which stores only ids and always resolves live — a bag should follow a
price change, an invoice must not.

**Money is stored in paise as an integer**, never a float. The catalogue is
authored in whole rupees, so conversion happens in exactly two places:
`rupeesToPaise` in and `formatPaise` out.

**The browser never sends a price.** The form submits ids and quantities; the
server prices the bag from the catalogue twice — once for the summary, once
inside the action immediately before writing — so a stale tab cannot buy at an
old price.

**Guests can check out.** No account is required. Because order numbers are
sequential and readable, a guest reaches their order through a signed link
(`?t=`, an HMAC of the order number); a signed-in customer is authorised by
session and gets no token.

```bash
npm run db:migrate    # creates the Order and OrderItem tables
```

Without `DATABASE_URL` the checkout page says orders aren't available rather
than collecting an address and failing on submit.

## Payments and delivery

Razorpay takes the money, Shiprocket moves the parcel. Both are optional: with
neither configured the storefront runs exactly as it did before, offering cash
on delivery and saying plainly that online payment isn't set up. Reasoning is
in `DECISIONS.md` §27.

### Razorpay

```bash
RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=a-long-random-string-you-choose
```

Register `https://your-domain/api/webhooks/razorpay` under Dashboard →
Settings → Webhooks, subscribed to `payment.captured`, `payment.failed` and
`order.paid`, using the same secret.

**The webhook is the source of truth, not the browser.** A UPI payment finishes
inside a banking app; the tab may never come back. Nothing but
`app/api/webhooks/razorpay/route.ts` ever writes `paidAt`, so a paid order is
never lost to a closed tab — and a browser cannot claim a payment that did not
happen. The signature is verified against the raw body before anything is
parsed, read or written, and every event is recorded under a unique index so a
redelivery changes nothing.

**The order is written before the payment is created.** An unreachable Razorpay
does not lose the order; the order page offers to start the payment again.

Locally, Razorpay cannot reach `localhost` — tunnel it (ngrok, `npx untun`) and
register the tunnel URL, or test payments will succeed on their side while the
order sits at "awaiting payment" forever. That is the design working, not a bug.

### Shiprocket

```bash
SHIPROCKET_EMAIL=api-user@yourdomain.com
SHIPROCKET_PASSWORD=the-password-shown-once
SHIPROCKET_PICKUP_LOCATION=Primary        # must already exist in their panel
SHIPROCKET_PICKUP_PINCODE=110030
SHIPROCKET_WEBHOOK_TOKEN=a-long-random-string-you-choose
CRON_SECRET=a-long-random-string-you-choose
SECRET_ENCRYPTION_KEY=base64-or-hex-of-32-random-bytes
```

**`SECRET_ENCRYPTION_KEY` encrypts the cached Shiprocket token at rest.** That
token is a bearer credential for the whole account and has to be replayed
verbatim, so unlike every other secret here it cannot be hashed — it is
AES-256-GCM instead (`lib/crypto/secretBox.ts`). Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Leaving it unset is safe, not broken: the token cache is skipped rather than
downgraded to plaintext, so the app just logs in again on each cold start.
Rotating it costs one extra login — the row is a cache of something
re-derivable, which is why encrypting it carries none of the usual key-rotation
burden. DECISIONS §28 has the full reasoning, including what this does and does
not protect against.

Credentials are for an **API user** (Settings → API → Add New API User), not
your main login. Register `https://your-domain/api/webhooks/courier` under
Settings → API → Webhooks with the same token — their docs forbid the words
"shiprocket", "sr", "kartrocket" and "kr" in a webhook URL, which is why the
route is named after the job rather than the vendor.

**Nothing in the buying path waits on the courier.** An order is written to
Postgres and a push job is queued *in the same transaction*; the push itself
happens later, from `/api/courier/sync` or the "Send to courier" button in
`/admin/orders`. If Shiprocket is down for six hours, six hours of orders wait
in the queue and no customer notices. Jobs back off and are never deleted, so a
failing push is visible in the admin rather than gone.

**The auth token is cached for nine days** (theirs last ten) in an
`IntegrationToken` row, because a serverless cold start would otherwise log in
every time and their login endpoint is rate limited.

**Pincode checks are on the product page and in the bag**, before checkout —
"will it reach me and when" is a question people ask before adding to a bag,
not after typing an address. Responses are cached for six hours per route. A
failed check says "couldn't check right now, you can still order"; it never
says undeliverable, because an API timeout is not an answer.

Schedule the sync on Vercel with a `vercel.json`:

```json
{ "crons": [{ "path": "/api/courier/sync", "schedule": "0 3 * * *" }] }
```

**Vercel's Hobby plan allows once-daily crons only**, with per-hour precision —
anything more frequent is rejected and the **deploy fails outright**, which is
why no `crons` block ships today. Pro and Enterprise allow once per minute. See
`DECISIONS.md` §27 and `DEPLOY.md` §4. `CRON_SECRET` must be set or the route
refuses the call.

It drains the push queue and re-reads tracking for shipments still in flight —
a safety net under the tracking webhook, which is the primary path.

```bash
npm run db:migrate    # adds the payment and delivery columns, WebhookEvent,
                      # OutboxJob and IntegrationToken
```

## Security

Admin hardening lives in a few places; `DECISIONS.md` §25 explains the reasoning.

**Rate limiting is in Postgres**, keyed by IP *and* by the identifier being
guessed, with exponential backoff. Two separate buckets, so one attacker
spreading guesses across many IPs cannot lock a real user out, and one IP cannot
dodge the limit by spreading guesses across many accounts.

The admin login **fails closed** — if the limiter cannot be read, the attempt is
refused. Customer sign-in **fails open**, because a shopper locked out by a
database blip is a lost sale and the account behind it is worth less than the
storefront staying usable.

**Captcha is Cloudflare Turnstile**, verified server-side in the action with the
remote IP included, and a reused token is rejected rather than assumed
single-use. Applied to `/admin/login`, `/account/register` and `/account/login`.

**Admin sessions are revocable.** The JWT carries a session id; the row is
checked on every admin page and every admin action. `middleware.ts` still does
the cheap Edge check on the token's signature, which stops admin markup
rendering before a redirect — **that is not authorization**, and the comment in
the file says so. `/admin/security` lists active sessions with a "sign out
everywhere else", and shows a read-only audit log.

Sessions use **sliding expiry**: active use extends them, idle ones hard-expire.

**Security headers** are set in `next.config.mjs` — CSP, HSTS,
`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and
`Permissions-Policy` — with `/admin` additionally `noindex` and `no-store` at
the header level, so a crawler following a redirect never sees an indexable
response. Server Actions are pinned to known origins.

```bash
npm run db:migrate    # creates the rate-limit, session and audit tables
```

## Admin dashboard

A content manager for non-technical staff lives at **`/admin`**. It edits the
same `/data` shapes the storefront renders — every form field maps to a real
field in [`data/types.ts`](data/types.ts).

**Sign in at `/admin/login`** with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Every
`/admin` route is gated by `middleware.ts`, so a direct URL visit while signed
out redirects rather than flashing content. Sessions last 7 days; "Sign out"
sits next to the profile chip in the top bar. Auth architecture is in
`DECISIONS.md` §17; the rate limiter it describes as an in-memory `Map` was
superseded by §25 and is now Postgres-backed, keyed by IP *and* identifier, with
exponential backoff — as the Security section above describes.

```
app/admin/            Admin routes (Overview, Homepage Sections, Products, Categories)
components/admin/     Admin-only components
  ui/                 Form + surface primitives (Button, Field, TextInput, …)
```

Built so far:

- **Overview** — stats, hero preview, unpublished-changes prompt
- **Homepage Sections** — Hero, Lookbook, Brand Statement, Product Rail, Trust
  Strip, Navigation, Footer (one per key of `HomepageContent`)
- **Products** and **Categories** — table plus slide-in edit drawer
- **Orders & Shipments** — every order, whether it's paid, where the parcel is,
  and a "Send to courier" button for anything the queue hasn't managed yet
- **Photos & Images** — the uploaded media library, with upload and delete
- **Security** — active admin sessions, "sign out everywhere else", audit log

Hero and Brand Statement share one `SectionEditor`. Settings and Product pages
are the only sidebar entries still marked "Soon".

**Changes persist.** "Publish changes" validates the draft and writes it to the
content store, and the storefront reads from that store rather than importing
`/data`. `/data` is the store's *seed*: it supplies the content until something
is published for the first time.

> [!WARNING]
> **Editing `/data` does not change a site that has published anything.** The
> seed is read once, ever. A link or a heading fixed in `/data` stays wrong on
> every running site — including your own dev machine — until the same edit is
> made in `/admin` and published. This has caused a user-visible dead link
> twice; see `DECISIONS.md` §31. `npm run content:check-links` reports dead
> internal links in whatever the store actually holds.

> [!IMPORTANT]
> The default store is a **JSON file** at `.content/site.json` (gitignored,
> override with `CONTENT_STORE_PATH`). It needs a writable disk, so it works in
> development and on a normal server or container but **not on a read-only
> serverless filesystem such as Vercel's.** Deploying there means writing one
> more `ContentStore` adapter — nothing else changes. See `DECISIONS.md` §15.

Admin uses a **separate visual system** from the storefront: `admin-*` colour
tokens, a dark sidebar, a light workspace, and one orange accent. Don't use
`admin-*` tokens in storefront code or storefront tokens (`ink`, `bone`,
`flare`) in admin code — see `DECISIONS.md` §14 and §16.

## Customer accounts

Shoppers can create an account at **`/account/register`**, sign in at
**`/account/login`**, and manage their saved addresses at **`/account`**. This
is entirely separate from `/admin`, which is still one username and password in
the environment — the admin is infrastructure, customers are data.

It needs Postgres. Point `DATABASE_URL` at a database, then:

```bash
npm run db:migrate     # creates the tables
```

Without `DATABASE_URL` the storefront runs exactly as before: the catalogue
comes from the JSON content store, the bag stays browser-local, and the account
pages report that accounts aren't available. Nothing crashes.

### How the bag survives a new phone

**localStorage stays the authority; the account is a mirror.** The bag and
wishlist keep working signed out, offline, and before any JavaScript has
spoken to the server — that does not change. What signing in adds is a second
copy in Postgres, kept in step by `components/AccountSync.tsx`:

- **At sign-in, and on every page load while signed in**, the two are merged
  once. On a quantity clash **the larger wins, never the sum** — the common
  case is one person adding the same jacket on a laptop and then on a phone,
  and that person wants one jacket.
- **After every change**, the whole list is pushed to the server, debounced,
  and flushed when the tab is hidden.

A failed sync is never surfaced: the bag on screen is correct either way, and
the next change re-sends everything.

### Sessions

Customer sessions are **rows in `CustomerSession`**, not self-contained tokens
— which is what makes "sign out" and "sign out everywhere" revoke something
real. The cookie holds a random opaque token; only its SHA-256 digest is
stored, so a leaked database dump cannot be replayed as a login. Passwords are
scrypt from `node:crypto` — memory-hard, no native addon to build, works
unchanged on a serverless runtime.

The admin's session is still a stateless JWT (`lib/session.ts`), and
deliberately so: it is one person on one laptop, checked in middleware that
must not touch a database.

### Deploying to Vercel

> [!IMPORTANT]
> **[`DEPLOY.md`](DEPLOY.md) is the checklist.** It has the minimum environment,
> what to leave unset on purpose, the release steps, and the three things that
> reliably go wrong — including the one that locks you out of `/admin` in front
> of a client. Read it before your first deploy.

The short version:

The `> [!IMPORTANT]` note above about the JSON content store no longer applies
once `DATABASE_URL` is set: content moves to the `ContentDocument` table and
the read-only filesystem stops mattering. **Uploaded images need a Blob store**:
create one under Project → Storage → Blob and connect it to the environments you
deploy, which sets `BLOB_READ_WRITE_TOKEN` and switches the media adapter over.
Without it, uploads on Vercel are refused rather than silently lost. §36.

If `/admin` has published anything on this machine, carry it across once:

```bash
npm run content:import
```

Run `npm run db:deploy` as part of releasing — the build does not do it.

The build command comes from `vercel.json`, which runs `npm run predeploy`
(ESLint plus [`content:check-links`](DEPLOY.md#2-before-you-push)) before
`npm run build`, so a dead internal link fails the deploy rather than reaching
production. Run it yourself first to save the round trip:

```bash
npm run predeploy
```

### Schema changes go through migrations, never `db push`

> [!IMPORTANT]
> **`prisma db push` is not the deploy path and must not be used as one.**
> It diffs your schema straight onto a database and writes no migration file.
> A deploy runs `npm run db:deploy` (`prisma migrate deploy`), which applies
> *files* — so a schema only ever pushed is a schema a fresh production
> database knows nothing about. It comes up empty and every query fails at
> runtime, with a green deploy.

This project got that wrong once and `prisma/migrations/` did not exist at all;
DECISIONS §28 records it and how the baseline was rebuilt and verified.

Changing the schema:

```bash
npm run db:migrate    # prisma migrate dev — writes a migration AND applies it
```

Commit the generated folder under `prisma/migrations/` with the schema change
in the same commit. `db push` is fine for throwaway experiments against a
scratch database; anything that reaches a branch someone else pulls needs a
migration.

**Adopting an existing `db push`-ed database.** It has the tables but no
`_prisma_migrations` bookkeeping, so `migrate deploy` will try to create what
is already there. Tell Prisma the baseline is already applied — once, per
database:

```bash
npx prisma migrate resolve --applied 20260831000939_init
```

Verify a migration reproduces the schema rather than assuming it. Against a
database with it applied, this must print "No difference detected":

```bash
npx prisma migrate diff --from-config-datasource --to-schema=prisma/schema.prisma
```

## Further reading

[`DECISIONS.md`](DECISIONS.md) records architecture decisions, the Next 14 → 16
upgrade notes, and the current list of known issues and follow-ups.
