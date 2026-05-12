/**
 * Production entry: apply pending Prisma migrations, then start the custom server.
 *
 * DigitalOcean App Platform build workers often cannot reach a managed Postgres
 * cluster (P1001 during `npm run build`). Migrations run here at **runtime** on
 * the same network path as the live app.
 *
 * Reuses `scripts/db-deploy.mjs` (same SKIP_DB_DEPLOY / env rules).
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbDeploy = path.join(__dirname, "db-deploy.mjs");

const migrate = spawnSync(process.execPath, [dbDeploy], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1);
}

const server = path.join(root, "server.js");
const run = spawnSync(process.execPath, [server], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

process.exit(run.status ?? 1);
