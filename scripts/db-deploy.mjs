/**
 * Apply pending Prisma migrations during App Platform / CI builds.
 *
 * Runs `prisma migrate deploy` — only executes SQL from `prisma/migrations/*`
 * that has not been applied yet. Unlike `prisma db push`, Prisma does not
 * infer destructive diffs from the schema file; what runs is exactly what is
 * in each migration (review each migration for additive-only changes).
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
  console.log("[db-deploy] SKIP_DB_DEPLOY=1 — skipping Prisma migrations.");
  process.exit(0);
}

const hasUrl =
  Boolean(process.env.TRADING_DATABASE_URL) ||
  Boolean(process.env.TRADING_DATABASE_DIRECT_URL);

if (!hasUrl) {
  console.warn(
    "[db-deploy] TRADING_DATABASE_URL / TRADING_DATABASE_DIRECT_URL not set — skipping migrations."
  );
  process.exit(0);
}

console.log("[db-deploy] Applying pending Prisma migrations (migrate deploy)…");

const r = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy"],
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
