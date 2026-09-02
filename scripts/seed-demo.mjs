/**
 * Seed a public demo that looks like a game people actually played.
 *
 *   node scripts/seed-demo.mjs
 *
 * Creates traders, several markets, two-sided books, and then places real orders
 * through the running app's own API — so every fill goes through the same margin
 * check and matching engine a real order would. Nothing is written straight into
 * the trades table; a fabricated fill would be exactly the kind of evidence this
 * project is meant not to produce.
 *
 * Environment:
 *   TRADING_DATABASE_URL / TRADING_DATABASE_DIRECT_URL   required
 *   APP_URL   the deployment to trade against
 *             (default https://prediction-market-exchange.onrender.com)
 *   DEMO_PASSWORD   reviewer account password (default demo-trader-2027)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";

// The API requires a UUIDv7 idempotency key and checks the version nibble;
// Node's randomUUID() is v4. Layout: 48-bit big-endian millisecond timestamp,
// version 7, variant 0b10, random elsewhere.
function uuidv7() {
  const ts = Date.now();
  const b = randomBytes(16);
  b[0] = Math.floor(ts / 2 ** 40) & 0xff;
  b[1] = Math.floor(ts / 2 ** 32) & 0xff;
  b[2] = Math.floor(ts / 2 ** 24) & 0xff;
  b[3] = Math.floor(ts / 2 ** 16) & 0xff;
  b[4] = Math.floor(ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const prisma = new PrismaClient();

const APP_URL = (process.env.APP_URL || "https://prediction-market-exchange.onrender.com").replace(/\/$/, "");
const REVIEWER_EMAIL = "demo@example.com";
const REVIEWER_PASSWORD = process.env.DEMO_PASSWORD || "demo-trader-2027";
const MARKER = "__demo_seed_v2";

// Mirrors lib/apiAuth.ts — 12-char public prefix, SHA-256 of the whole key.
const API_KEY_PREFIX = "tgk_";
const KEY_PREFIX_LEN = 12;
function generateApiKey() {
  const fullKey = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    fullKey,
    keyPrefix: fullKey.slice(0, KEY_PREFIX_LEN),
    hashedSecret: createHash("sha256").update(fullKey).digest("hex"),
  };
}

async function upsertUser({ username, email, role, balance, password }) {
  const hashedPassword = await bcrypt.hash(
    password || randomBytes(24).toString("base64url"),
    12
  );
  return prisma.user.upsert({
    where: { email },
    update: { status: "ACTIVE" },
    create: { username, email, hashedPassword, role, status: "ACTIVE", balance },
  });
}

async function apiKeyFor(userId) {
  const k = generateApiKey();
  await prisma.apiKey.create({
    data: {
      userId,
      label: MARKER,
      keyPrefix: k.keyPrefix,
      hashedSecret: k.hashedSecret,
      scopes: ["read", "trade"],
    },
  });
  return k.fullKey;
}

async function placeOrder(key, body) {
  const res = await fetch(`${APP_URL}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "Idempotency-Key": uuidv7(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 200) };
}

const MARKETS = [
  {
    title: "How many home runs will be hit league-wide on opening day?",
    description:
      "Binary spread market. Quote a price you would both buy and sell at; settlement pays the distance between your fill and the true answer, capped at the contract size.",
    min: 0, max: 200,
    quotes: [[96, 20, 104, 20], [93, 35, 108, 30], [88, 50, 115, 45], [80, 60, 124, 55]],
  },
  {
    title: "Combined points in the Super Bowl",
    description: "Over/under on total points scored by both teams.",
    min: 0, max: 120,
    quotes: [[44, 25, 49, 25], [41, 40, 53, 35], [37, 55, 58, 50]],
  },
  {
    title: "US CPI year-over-year print, next release (basis points)",
    description: "Headline CPI YoY, quoted in basis points. 310 means 3.10%.",
    min: 0, max: 800,
    quotes: [[302, 30, 312, 30], [296, 45, 319, 40], [288, 60, 328, 55]],
  },
  {
    title: "Number of named Atlantic storms this season",
    description: "Settles on the final count published at end of season.",
    min: 0, max: 40,
    quotes: [[16, 30, 19, 30], [14, 45, 22, 40]],
  },
];

async function main() {
  const reviewer = await upsertUser({
    username: "demo", email: REVIEWER_EMAIL, role: "USER",
    balance: 1000, password: REVIEWER_PASSWORD,
  });
  const mm1 = await upsertUser({ username: "quotes_north", email: "mm1@demo.invalid", role: "LIQUIDITY_PROVIDER", balance: 20000 });
  const mm2 = await upsertUser({ username: "quotes_south", email: "mm2@demo.invalid", role: "LIQUIDITY_PROVIDER", balance: 20000 });
  const takers = [];
  for (const n of ["r_okafor", "j_lindqvist", "m_tanaka", "p_varga", "s_adeyemi"]) {
    takers.push(await upsertUser({ username: n, email: `${n}@demo.invalid`, role: "USER", balance: 5000 }));
  }
  console.log(`Users ready: reviewer + 2 makers + ${takers.length} takers`);

  let created = [];
  const existing = await prisma.contract.findMany({
    where: { description: { contains: MARKER } },
  });
  if (existing.length) {
    console.log(`Markets already present (${existing.length}) — skipping creation.`);
    created = existing
      .map((c) => ({ contract: c, spec: MARKETS.find((m) => m.title === c.title) }))
      .filter((x) => x.spec);
  }
  for (const [i, m] of created.length ? [] : MARKETS.entries()) {
    const contract = await prisma.contract.create({
      data: {
        title: m.title,
        // marker lives here so a rerun can detect the dataset
        description: `${m.description}\n\n<!-- ${MARKER} -->`,
        status: "OPEN",
        minPrice: m.min,
        maxPrice: m.max,
        createdById: (i % 2 === 0 ? mm1 : mm2).id,
      },
    });
    for (const [j, [bid, bidSize, ask, askSize]] of m.quotes.entries()) {
      await prisma.quote.create({
        data: {
          contractId: contract.id,
          makerId: (j % 2 === 0 ? mm1 : mm2).id,
          bid, bidSize, ask, askSize,
          status: "OPEN",
        },
      });
    }
    created.push({ contract, spec: m });
    console.log(`  market ${contract.id}: ${m.title.slice(0, 52)}… (${m.quotes.length} quotes)`);
  }

  // Real orders, through the deployment's own API.
  const keys = [];
  for (const t of takers) keys.push({ user: t, key: await apiKeyFor(t.id) });

  console.log(`\nPlacing orders against ${APP_URL} …`);
  let filled = 0, rejected = 0;
  for (const { contract, spec } of created) {
    const inside = spec.quotes[0];
    const plan = [
      { side: "OVER", size: 6, limitPrice: inside[2] },
      { side: "UNDER", size: 4, limitPrice: inside[0] },
      { side: "OVER", size: 9, limitPrice: spec.quotes[1][2] },
      { side: "UNDER", size: 7, limitPrice: spec.quotes[1][0] },
    ];
    for (const [i, p] of plan.entries()) {
      const { user, key } = keys[(contract.id + i) % keys.length];
      const r = await placeOrder(key, {
        contractId: contract.id, type: "LIMIT", ...p,
      });
      if (r.status === 200 || r.status === 201) { filled++; }
      else { rejected++; console.log(`    ${user.username} ${p.side} ${p.size}@${p.limitPrice} -> ${r.status} ${r.body}`); }
    }
  }
  console.log(`\nOrders accepted: ${filled}, rejected: ${rejected}`);

  const trades = await prisma.trade.count();
  console.log(`Trades in database: ${trades}`);
  console.log(`\nReviewer login: ${REVIEWER_EMAIL} / ${REVIEWER_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
