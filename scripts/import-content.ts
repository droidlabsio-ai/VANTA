/**
 * One-time move of the published site content from `.content/site.json` into
 * Postgres.
 *
 * Run it once, after pointing DATABASE_URL at a database and running the
 * migration, if `/admin` has ever published anything on this machine:
 *
 *   npm run content:import
 *
 * Without it the Postgres store starts empty and the site falls back to the
 * `/data` seed — which looks exactly like every edit ever made was lost.
 *
 * Safe to run twice: it refuses to overwrite content that is already in the
 * database unless `--force` is passed.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../lib/generated/prisma/client";

/**
 * `.env.local` first, then `.env`, neither overriding a variable already
 * exported in the shell — the order `prisma.config.ts` uses, for the same
 * reason. `tsx` loads no env file of its own, and this project keeps its
 * variables in `.env.local`.
 *
 * This used to be `import "dotenv/config"`, which reads `.env` alone. With no
 * `.env` in the project the import stopped at "DATABASE_URL is not set" every
 * time, however correctly the database was configured.
 */
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const STORE_PATH =
  process.env.CONTENT_STORE_PATH ?? path.join(process.cwd(), ".content", "site.json");
const DRAFT_PATH = path.join(path.dirname(STORE_PATH), "draft.json");

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — there is nothing to import into.");
  }

  const force = process.argv.includes("--force");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const published = await readJson(STORE_PATH);
    if (!published) {
      console.log(`Nothing to import: ${STORE_PATH} does not exist.`);
      return;
    }

    const existing = await prisma.contentDocument.findUnique({
      where: { key: "published" },
      select: { savedAt: true },
    });

    if (existing && !force) {
      console.log(
        `Postgres already holds published content (saved ${existing.savedAt.toISOString()}).\n` +
          "Nothing was changed. Pass --force to overwrite it with the file.",
      );
      return;
    }

    await prisma.contentDocument.upsert({
      where: { key: "published" },
      create: { key: "published", content: published as never },
      update: { content: published as never },
    });
    console.log(`Imported published content from ${STORE_PATH}.`);

    // The draft comes along too, or an editor with unsaved work loses it at
    // exactly the moment they were told nothing would change.
    const draft = (await readJson(DRAFT_PATH)) as { content?: unknown } | null;
    if (draft?.content) {
      await prisma.contentDocument.upsert({
        where: { key: "draft" },
        create: { key: "draft", content: draft.content as never },
        update: { content: draft.content as never },
      });
      console.log(`Imported the unpublished draft from ${DRAFT_PATH}.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
