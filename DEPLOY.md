# Deploying VANTA

A pre-deploy checklist. Written for the Vercel case because that is the target,
but everything except the Blob/cron notes applies anywhere.

Read this top to bottom the first time. The three things that most commonly go
wrong are called out with `> [!WARNING]`, and one of them will lock you out of
`/admin` in front of whoever you are demoing to.

---

## 1. The environment

`.env.local.example` is the full annotated list and stays the reference. This is
the shorter question: **what is the minimum for a working demo, and what should
be left unset on purpose?**

### Required — the site is broken or unreachable without these

| Variable | Why |
|---|---|
| `DATABASE_URL` | Pooled connection. Without it there are no accounts, no orders, no checkout, and content falls back to the `/data` seed. **Scope it to Preview as well as Production** — see §2. |
| `DIRECT_DATABASE_URL` | Unpooled, for `prisma migrate` only. Needed wherever the two differ (Neon, Supabase, PgBouncer) — a transaction-mode pooler cannot hold the advisory lock a migration takes. |
| `ADMIN_USERNAME` | Sign-in at `/admin/login`. |
| `ADMIN_PASSWORD` | Sign-in at `/admin/login`. Use something long. |
| `ADMIN_SESSION_SECRET` | **At least 32 characters.** Signs the admin session *and* the guest order links — `lib/orders.ts` throws if it is missing or short, so checkout breaks too, not just the admin. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | The captcha widget on `/admin/login`. See the warning below. |
| `TURNSTILE_SECRET_KEY` | Verifies it. See the warning below. |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain` — no trailing slash. See §3. |
| `BLOB_READ_WRITE_TOKEN` | Set for you when you create a Blob store. Without it, `/admin` photo uploads are refused on Vercel rather than silently lost. See the warning below. |

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> [!WARNING]
> **An unset `TURNSTILE_SECRET_KEY` locks you out of `/admin` completely.**
>
> This is the single most likely way to be stuck in front of a client, and it is
> deliberate rather than a bug. `/admin/login` **fails closed**: with no captcha
> configured it refuses *every* sign-in and says
> *"Sign-in isn't available: this server has no captcha configured."* — correct
> credentials included. There is no bypass, because an admin login that silently
> drops its captcha the moment an environment variable goes missing is worse
> than one that never had it: everything keeps working and nobody finds out.
>
> The customer forms behave the **opposite** way — `verifyTurnstileIfConfigured`
> returns `{ ok: true, reason: "skipped-unconfigured" }`, so sign-up and sign-in
> still work without Turnstile. The asymmetry is intentional (§17, §25); do not
> "fix" it by making the admin match.
>
> Both keys are needed, not just the secret: without the public site key the
> widget never renders, so there is no token to verify.
>
> Turnstile keys are free from the Cloudflare dashboard and take two minutes.
> If you are locked out *right now* and need in, Cloudflare publishes an
> always-passing test pair:
>
> ```
> NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
> TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
> ```
>
> Those make the captcha decorative. Use them to get unstuck, then replace them
> — do not leave them on a public URL.

### Leave unset for a demo, on purpose

Everything here degrades honestly. Nothing 500s, and the storefront says what is
unavailable rather than pretending.

| Variable(s) | What happens when unset |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Checkout offers cash on delivery only, and the "Pay online" option says card and UPI are not connected. Orders are still placed and recorded. |
| `SHIPROCKET_*` | Orders are taken and recorded as normal. The pincode check says it cannot check right now, and courier pushes queue in `/admin/orders` until credentials exist. Nothing blocks a sale — that is the §27 rule. |
| `SHIPROCKET_WEBHOOK_TOKEN` | The courier webhook refuses every request rather than accepting unauthenticated ones. |
| `SECRET_ENCRYPTION_KEY` | Safe. The Shiprocket token cache is skipped rather than downgraded to plaintext, so it just logs in more often. Only matters once Shiprocket is connected. |
| `CRON_SECRET` | `/api/courier/sync` refuses everything. Correct while there is no scheduler — see §4. |

> [!WARNING]
> **Photo uploads need a Blob store on Vercel.**
>
> `.content/uploads/` is the local-development default, and Vercel's filesystem
> is ephemeral — a write there succeeds and the file is gone at the next deploy.
> So on Vercel the upload path refuses rather than losing your photo: the picker
> shows *"The file media adapter cannot work on Vercel…"* naming the variable to
> set. §36.
>
> Fix it in two minutes:
>
> 1. Project → **Storage** → **Create Database** → **Blob**
> 2. Connect it to the project, including the environments you deploy
>
> That sets `BLOB_READ_WRITE_TOKEN` automatically, which is the variable the
> adapter selects on — nothing else to configure. Images in `public/images` were
> never affected; this is only photos added through `/admin` → Photos.
>
> To run against Blob locally, `vercel env pull` and the same variable applies.
> `MEDIA_STORE_DRIVER=file|blob` overrides the inference either way.

---

## 2. Before you push

```bash
npm run predeploy
```

Two checks, with **different severities on purpose** (§34):

| Check | Local | Preview deploy | Production deploy |
|---|---|---|---|
| `content:check-links` | fatal | fatal | fatal |
| ESLint | fatal | **reported, not blocking** | fatal |

A dead internal link is user-visible breakage — somebody clicks it and gets a
404 — and it has shipped twice (§31). It blocks everywhere. An unused import is
style, and one of those stopping a build the night before a demo helps nobody.

So there is always a way to get a working URL in front of somebody: **deploy to
a preview**. Lint is printed there but does not block. Fix it before promoting
to production, which stays strict.

There is deliberately no "skip checks" variable. An override you can reach for
in a hurry is an override that also turns off the link check.

`vercel.json` sets `buildCommand` to `npm run predeploy && npm run build`, so
this runs on every deploy whether or not anyone remembers. Running it locally
first just saves the round trip.

Note that `next build` does **not** run ESLint — Next 16 removed `next lint`
entirely, so `npm run predeploy` is the only thing linting. TypeScript is
separate and still fails the build on any target.

Also worth running once:

```bash
npm run build
```

### The link check tells you what it read

Every run prints its source, and this matters more than it sounds:

```
Store:   file — /path/to/.content/site.json
Read:    the published document (published 2026-09-02T17:51:39.471Z)
Checked: 63 distinct internal links
Result:  all resolve.
```

If it says it read *the /data seed*, it checked the repository's starting
content — correct only when nothing has ever been published. If it names a
publish timestamp, it read the real document. §34 explains why it refuses to
pass when it cannot tell which.

> [!WARNING]
> **`DATABASE_URL` must be scoped to every environment you deploy — Preview
> included, not Production alone.**
>
> There is no build-versus-runtime toggle to get half-right. Vercel's only
> scoping axis is **Production / Preview / Development**, and a variable scoped
> to an environment is available to that deployment *both* during the build step
> and at runtime. `Sensitive`/`Secret` typing does not change this — those
> values are present during builds, which is why Vercel redacts them from build
> *logs* rather than withholding them.
>
> The way it actually goes missing is the environment axis. **Vercel Marketplace
> resources — Neon among them — can be connected to Production only**, which
> removes non-production access and drops the Preview connection. A branch build
> then runs with `DATABASE_URL` unset, `selectStore()` silently returns the file
> adapter, and there is no `.content/site.json` on a fresh checkout — so it
> would fall back to the `/data` seed. Before §34 that combination passed green
> while the published content nobody read stayed unchecked.
>
> It now **fails the build** instead, with:
>
> ```
> FAILED — no published content, and no database configured.
>   driver:    file (inferred — DATABASE_URL is not set here)
> ```
>
> If you see that on a Preview deploy, widen the database connection to Preview.
> If the deployment genuinely has no database and serves the seed, declare it
> with `CONTENT_STORE_DRIVER=file` and the check will pass and say so.
>
> `NEXT_PUBLIC_SITE_URL` (§3) needs the same breadth for a different reason — it
> is *inlined* at build time, so a Preview build without it bakes in the
> fallback. Set every variable for **all** environments unless you have a
> specific reason not to.

---

## 3. `NEXT_PUBLIC_SITE_URL` is read at **build** time

`NEXT_PUBLIC_*` values are inlined into the bundle when the site is built, not
when it is served. Setting this variable after a build and restarting changes
nothing.

If it is missing at build time, `lib/siteUrl.ts` falls back to
`http://localhost:3000` and `siteUrlIsPlaceholder` becomes true, which
deliberately degrades three things rather than shipping localhost URLs to
crawlers:

- `robots.txt` omits its `Sitemap:` line
- `sitemap.xml` returns **empty**
- Breadcrumb JSON-LD is not emitted

The storefront itself works fine. Canonicals and share images will point at
localhost, which is why this is on the required list. On Vercel,
`VERCEL_PROJECT_PRODUCTION_URL` is detected automatically, so the variable is
only strictly needed on a custom domain — but set it explicitly anyway, because
preview deployments otherwise canonicalise to the production URL.

**Verify after deploying:**

```bash
curl -s https://your-domain/robots.txt | grep Sitemap
curl -s https://your-domain/sitemap.xml | grep -c "<url>"
```

The first must print a `Sitemap:` line on your real domain; the second must
print a number well above zero (59 with the current catalogue).

---

## 4. No cron is configured

`vercel.json` used to declare `/api/courier/sync` at `*/15 * * * *`. It is gone,
because **Hobby accounts are limited to once-daily crons** and anything more
frequent fails at deploy time, not at run time:

> Hobby accounts are limited to daily cron jobs. This cron expression would run
> more than once per day.

Confirmed against Vercel's current docs (`/docs/cron-jobs/usage-and-pricing`):
Hobby is *once per day* with *per-hour* precision — a job set for 01:00 fires
somewhere between 01:00 and 01:59. Pro and Enterprise allow once per minute.

Nothing is broken by its absence. The sync is a **safety net**, not the primary
path: Shiprocket's tracking webhook does the real work, and staff can drain the
push queue by hand from `/admin/orders`. See DECISIONS §27.

Three ways forward, in increasing order of cost:

1. **Leave it off** — correct for a demo, and what ships today.
2. **A daily cron on Hobby.** Permitted, and better than nothing for a safety
   net whose job is catching a webhook that went missing. Add back to
   `vercel.json`, remembering `CRON_SECRET` or the route refuses the call:

   ```json
   "crons": [{ "path": "/api/courier/sync", "schedule": "0 3 * * *" }]
   ```

3. **Pro, or an external scheduler.** Only worth it once tracking freshness
   matters to a real customer.

---

## 5. Release

1. **Set the environment** (§1), in the Vercel project settings, for the
   environments you are deploying — not just Production, or preview builds get
   the placeholder-URL behaviour from §3.

2. **Run migrations.** The build does *not* do this.

   ```bash
   npm run db:deploy
   ```

   Applies `prisma/migrations/` to `DIRECT_DATABASE_URL`. Never use
   `prisma db push` — see the warning in `README.md`; a schema only ever pushed
   is a schema a fresh production database knows nothing about.

   **Getting the URL into the shell without leaving it on disk.** This runs from
   your machine against production, so the connection string has to be in the
   environment for one command — and the obvious way writes it somewhere
   permanent. On Windows, PSReadLine appends every interactive line to
   `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`,
   and its default sensitive-command filter only matches `password`, `token`,
   `secret` and `apikey` — none of which appear in `DIRECT_DATABASE_URL`. So
   `$env:DIRECT_DATABASE_URL = '<url>'` writes a live database credential to a
   plaintext file that outlives the terminal.

   Prompt for it instead, so the value is never a command-line argument in the
   first place. This is shell-history-proof on every platform, which
   remembering to scrub afterwards is not:

   ```powershell
   $secure = Read-Host "DIRECT_DATABASE_URL" -AsSecureString
   $env:DIRECT_DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
     [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
   npm run db:deploy
   $env:DIRECT_DATABASE_URL = $null
   ```

   The bash equivalent is `read -rs DIRECT_DATABASE_URL` followed by
   `export DIRECT_DATABASE_URL`. Either way the variable dies with the shell —
   pulling it from `vercel env pull` into a gitignored `.env.local` works too,
   and `prisma.config.ts` reads that file deliberately (§24).

   Adopting a database that was previously `db push`-ed? It has the tables but
   no migration bookkeeping, so tell Prisma the baseline is already applied,
   once:

   ```bash
   npx prisma migrate resolve --applied 20260831000939_init
   ```

3. **Deploy.** The build command in `vercel.json` runs `predeploy` then `build`.

4. **Carry content across, if there is any.** Only if `/admin` has published on
   the machine you are deploying from — otherwise skip it; the site falls back
   to the `/data` seed, which is a complete catalogue.

   ```bash
   npm run content:import
   ```

   Without this, a Postgres content store starts empty and the site serves the
   seed, which looks exactly like every edit ever made was lost.

5. **Smoke test**, in this order — each one fails differently:

   ```bash
   curl -sI https://your-domain/                     # 200, no X-Powered-By
   curl -s  https://your-domain/robots.txt           # Sitemap: line present
   curl -so /dev/null -w '%{http_code}\n' \
        https://your-domain/no-such-page             # 404, not 200
   ```

   Then in a browser: sign in at `/admin/login` (the Turnstile warning above is
   about this step), open a product page, add to bag, and complete a cash-on-
   delivery checkout. That last one exercises the database, the order writer and
   the guest order link in one pass.

   Finally, upload a photo in `/admin` → Photos and **redeploy**, then check the
   photo is still there. That is the only way to confirm the Blob store is
   actually being used — the failure it replaces looked exactly like success
   until the next deploy. A phone photo is the right test file: it is large
   enough to exercise the browser-side downscale that keeps uploads under
   Vercel's 4.5 MB request-body limit.

---

## Related

- `README.md` — running locally, the content store, schema changes
- `.env.local.example` — every variable, annotated
- `DECISIONS.md` — why any of this is the way it is; §27 for payments and
  courier, §31 for the published-vs-seed trap, "Known issues" for what is still
  outstanding
