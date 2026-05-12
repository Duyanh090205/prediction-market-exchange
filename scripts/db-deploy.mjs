/**
 * Apply pending Prisma migrations (`prisma migrate deploy`).
 *
 * Used by:
 * - `npm run db:deploy` — manual / local
 * - `scripts/start-with-migrate.js` — **production** (App Platform `npm start`), because
 *   build workers often cannot reach managed Postgres (P1001); runtime can.
 *
 * - Set SKIP_DB_DEPLOY=1 to skip (e.g. local `npm start` without a DB).
 * - If neither TRADING_DATABASE_URL nor TRADING_DATABASE_DIRECT_URL is set, skips
 *   with a warning.
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
