/**
 * Apply pending Prisma migrations to the database the deployment itself uses.
 * §46.
 *
 *     node scripts/vercel-migrate.mjs     (run by vercel.json's buildCommand)
 *
 * ## Why this exists
 *
 * Production's `DATABASE_URL` is a Sensitive variable in Vercel: it can be
 * written but never read back, and on 2026-09-26 the database it points at
 * could not be found in any Neon login the owner has. §44's migration was
 * therefore applied to the development database by mistake, and the live site
 * had no `PasswordResetToken` table. The one place that provably holds the
 * right address is the deployment, so the deployment applies the migration.
 *
 * ## Off unless switched on
 *
 * Does nothing unless `RUN_DB_MIGRATIONS=1` is set for the environment being
 * built. Migrations change a live database and should happen because someone
 * decided they should, not because a commit happened to land. The intended
 * use: set the variable in Vercel (Production), redeploy, read the log, then
 * remove it — or leave it on if migrate-on-deploy becomes the policy.
 *
 * ## What it prints
 *
 * The database host and name, never the username or password, so the build
 * log also answers "which database is production?". Prisma's own output prints
 * the same host line and no credentials.
 *
 * ## Pooled vs direct
 *
 * A migration takes an advisory lock that a transaction-mode pooler cannot
 * hold (see prisma.config.ts). For Neon, the direct host is the pooled host
 * without `-pooler`, so the direct URL is derived from `DATABASE_URL` rather
 * than read from `DIRECT_DATABASE_URL` — which in production was last set on
 * Sep 5, before `DATABASE_URL` was changed on Sep 13, and so cannot be trusted
 * to point at the same database. For any other host the URL is used as given.
 *
 * Fails the build if the migration fails: deploying code that expects a table
 * the database does not have is exactly the outage this exists to prevent.
 */
import { spawnSync } from "node:child_process";

const env = process.env.VERCEL_ENV ?? "local";

if (process.env.RUN_DB_MIGRATIONS !== "1") {
  console.log(`[migrate] skipped (RUN_DB_MIGRATIONS is not "1" for ${env}).`);
  process.exit(0);
}

const raw = process.env.DATABASE_URL?.trim();
if (!raw) {
  console.error(`[migrate] RUN_DB_MIGRATIONS=1 but DATABASE_URL is not set for ${env}.`);
  process.exit(1);
}

/** Derives the direct (unpooled) URL for a Neon pooler host; otherwise returns the input. */
function directUrlFor(value) {
  const url = new URL(value);
  if (/-pooler\./.test(url.hostname) && url.hostname.endsWith(".neon.tech")) {
    url.hostname = url.hostname.replace("-pooler.", ".");
    // pgbouncer mode flags only make sense on the pooler.
    url.searchParams.delete("pgbouncer");
    return { url: url.toString(), derived: true };
  }
  return { url: value, derived: false };
}

let target;
try {
  target = directUrlFor(raw);
} catch {
  console.error("[migrate] DATABASE_URL is not a valid URL.");
  process.exit(1);
}

const parsed = new URL(target.url);
console.log(
  `[migrate] ${env}: applying migrations to host ${parsed.hostname}, database ${
    parsed.pathname.replace(/^\//, "") || "(default)"
  }${target.derived ? " (direct host derived from the pooled DATABASE_URL)" : ""}.`,
);

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DIRECT_DATABASE_URL: target.url },
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.error(`[migrate] prisma migrate deploy failed (exit ${result.status ?? "signal"}).`);
  process.exit(result.status ?? 1);
}
console.log("[migrate] done.");
