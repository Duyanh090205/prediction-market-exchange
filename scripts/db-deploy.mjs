/**
 * Idempotent DB schema sync for App Platform / CI builds.
 *
 * Runs `prisma db push` so an empty database gets all tables from schema.prisma
 * without requiring a shadow DB (unlike `prisma migrate dev`).
 *
 * - Set SKIP_DB_DEPLOY=1 to skip (e.g. CI that only typechecks).
 * - If neither TRADING_DATABASE_URL nor TRADING_DATABASE_DIRECT_URL is set, skips
 *   with a warning so `npm run build` still works locally without Postgres.
 *
 * @see https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

if (process.env.SKIP_DB_DEPLOY === "1") {
  console.log("[db-deploy] SKIP_DB_DEPLOY=1 — skipping Prisma schema sync.");
  process.exit(0);
}

const hasUrl =
  Boolean(process.env.TRADING_DATABASE_URL) ||
  Boolean(process.env.TRADING_DATABASE_DIRECT_URL);

if (!hasUrl) {
  console.warn(
    "[db-deploy] TRADING_DATABASE_URL / TRADING_DATABASE_DIRECT_URL not set — skipping schema sync."
  );
  process.exit(0);
}

console.log("[db-deploy] Applying Prisma schema (db push)…");

const r = spawnSync(
  "npx",
  ["prisma", "db", "push", "--skip-generate"],
  {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  }
);

if (r.error) {
  console.error("[db-deploy]", r.error);
  process.exit(1);
}

process.exit(r.status ?? 1);
