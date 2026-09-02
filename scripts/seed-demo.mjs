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
 * The one thing this script edits after the fact is `Trade.createdAt` (and the
 * PricePoint rows derived from the same fills): every order executes within the
 * minute the script runs, and a tape carrying fifteen prints at one timestamp
 * reads as a script rather than a session. Only the clock moves. The prices,
 * the sizes and who was on each side are whatever the engine produced.
 *
 * Environment:
 *   TRADING_DATABASE_URL / TRADING_DATABASE_DIRECT_URL   required
 *   APP_URL   the deployment to trade against
 *             (default https://prediction-market-exchange.onrender.com)
 *   DEMO_PASSWORD   reviewer account password (default demo-trader-2027)
 *   TAPE_HOURS      how far back to spread the tape (default 6)
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
const TAPE_HOURS = Number(process.env.TAPE_HOURS || 6);
const KEY_LABEL = "demo seed";

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
  // One key per seed user, replaced on each run rather than accumulating.
  await prisma.apiKey.deleteMany({ where: { userId, label: KEY_LABEL } });
  const k = generateApiKey();
  await prisma.apiKey.create({
    data: {
      userId,
      label: KEY_LABEL,
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

// ── The book ────────────────────────────────────────────────────────────────
//
// Six levels a side, sizes tapering as they move away from the mid, posted by
// both market makers at every level so each price carries more than one queue
// entry — the book expands a level to show who is resting there, in the time
// priority the engine actually sweeps.

const LEVELS = 6;
const TOP_SIZE = 12;
const DECAY = 0.82;
// Each maker posts the ladder this many times, so the displayed depth is deep
// enough to read as a market while the individual quote sizes stay small enough
// that the seeded orders walk through several levels instead of all printing at
// the touch.
const LADDER_PASSES = 2;

function ladder({ mid, tick }) {
  const out = [];
  for (let i = 0; i < LEVELS; i++) {
    const size = Math.max(3, Math.round(TOP_SIZE * DECAY ** i));
    out.push({
      bid: mid - tick * (i + 1),
      ask: mid + tick * (i + 1),
      // The second maker rests behind the first at the same price.
      sizes: [size, Math.max(2, Math.round(size * 0.7))],
    });
  }
  return out;
}

// Aggressor sequence per market: signed level depth (positive lifts offers,
// negative hits bids) paired with a size. Fifteen orders that drift up, get
// sold into, then chop — enough for the tape and the transaction-price chart to
// show a session rather than one print repeated.
const PATH = [1, -1, 2, 1, -2, 1, -1, 3, -1, 2, -2, 1, -1, 2, -1];
const SIZES = [4, 3, 2, 5, 3, 2, 4, 3, 2, 5, 3, 4, 2, 3, 2];

function tradePlan({ mid, tick }) {
  return PATH.map((depth, i) => ({
    side: depth > 0 ? "OVER" : "UNDER",
    size: SIZES[i],
    limitPrice: mid + tick * depth,
  }));
}

const MARKETS = [
  {
    title: "How many home runs will be hit league-wide on opening day?",
    description:
      "Binary spread market. Quote a price you would both buy and sell at; settlement pays the distance between your fill and the true answer, capped at the contract size.",
    min: 0, max: 200, mid: 100, tick: 4,
  },
  {
    title: "Combined points in the Super Bowl",
    description: "Over/under on total points scored by both teams.",
    min: 0, max: 120, mid: 46, tick: 2,
  },
  {
    title: "US CPI year-over-year print, next release (basis points)",
    description: "Headline CPI YoY, quoted in basis points. 310 means 3.10%.",
    min: 0, max: 800, mid: 307, tick: 5,
  },
  {
    title: "Number of named Atlantic storms this season",
    description: "Settles on the final count published at end of season.",
    min: 0, max: 40, mid: 17, tick: 1,
  },
];

/**
 * Cancel the seed makers' resting quotes on a market that already exists.
 *
 * A rerun against a database seeded by an older version of this script would
 * otherwise leave that version's price grid resting alongside the current one —
 * a book with levels at 96, 93, 92, 88, 84, 80 and 76, which is not a shape any
 * market maker would quote. Only the two seed makers are touched; quotes from
 * real or demo accounts are left alone, and trades already matched against a
 * cancelled quote keep pointing at it.
 */
async function clearSeedQuotes(contractId, makers) {
  const res = await prisma.quote.updateMany({
    where: {
      contractId,
      status: "OPEN",
      makerId: { in: makers.map((m) => m.id) },
    },
    data: { status: "CANCELLED" },
  });
  return res.count;
}

/** Full depth intended at one level, across every maker and every pass. */
function levelTarget(lvl) {
  return lvl.sizes.reduce((a, b) => a + b, 0) * LADDER_PASSES;
}

async function postLadder(contractId, spec, makers) {
  const levels = ladder(spec);
  let posted = 0;
  for (let pass = 0; pass < LADDER_PASSES; pass++) {
    for (const lvl of levels) {
      for (const [n, maker] of makers.entries()) {
        await prisma.quote.create({
          data: {
            contractId,
            makerId: maker.id,
            bid: lvl.bid,
            bidSize: lvl.sizes[n],
            ask: lvl.ask,
            askSize: lvl.sizes[n],
            status: "OPEN",
          },
        });
        posted++;
      }
    }
  }
  return posted;
}

/**
 * Top each level back up to its target, rather than stacking another whole
 * ladder on top of the leftovers.
 *
 * The orders eat into the touch first, so a blind second ladder leaves the best
 * price thinner than the one behind it — the opposite of the shape being seeded.
 * This adds only the difference, which is also what makes a rerun idempotent.
 */
async function replenishLadder(contractId, spec, makers) {
  const levels = ladder(spec);
  const open = await prisma.quote.findMany({
    where: { contractId, status: "OPEN" },
    select: { bid: true, bidSize: true, ask: true, askSize: true },
  });

  const depthAt = (side, price) =>
    open
      .filter((q) => q[side] === price)
      .reduce((s, q) => s + (q[side === "bid" ? "bidSize" : "askSize"] ?? 0), 0);

  let added = 0;
  for (const lvl of levels) {
    const target = levelTarget(lvl);
    const bidGap = target - depthAt("bid", lvl.bid);
    const askGap = target - depthAt("ask", lvl.ask);
    if (bidGap <= 0 && askGap <= 0) continue;
    await prisma.quote.create({
      data: {
        contractId,
        makerId: makers[0].id,
        bid: bidGap > 0 ? lvl.bid : null,
        bidSize: bidGap > 0 ? bidGap : null,
        ask: askGap > 0 ? lvl.ask : null,
        askSize: askGap > 0 ? askGap : null,
        status: "OPEN",
      },
    });
    added++;
  }
  return added;
}

/**
 * Spread this run's fills back over TAPE_HOURS, preserving their order.
 *
 * Only the timestamps move. Without this every print carries the same clock
 * time and the transaction-price chart collapses to a single vertical line.
 */
async function spreadTape(contractIds, since) {
  const windowMs = TAPE_HOURS * 60 * 60 * 1000;
  let moved = 0;

  for (const contractId of contractIds) {
    const trades = await prisma.trade.findMany({
      where: { contractId, createdAt: { gte: since } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (trades.length === 0) continue;

    // Even spacing with jitter, ending a few minutes before now so the last
    // print does not sit exactly on the seed time.
    const end = Date.now() - 4 * 60 * 1000;
    const step = windowMs / (trades.length + 1);
    const stamps = trades
      .map((_, i) => {
        const base = end - windowMs + step * (i + 1);
        return base + (Math.random() - 0.5) * step * 0.6;
      })
      .sort((a, b) => a - b)
      .map((ms) => new Date(ms));

    for (const [i, t] of trades.entries()) {
      await prisma.trade.update({
        where: { id: t.id },
        data: { createdAt: stamps[i] },
      });
    }
    moved += trades.length;

    // Keep the mid series on the same clock as the tape it came from.
    const points = await prisma.pricePoint.findMany({
      where: { contractId, ts: { gte: since } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    for (const [i, p] of points.entries()) {
      await prisma.pricePoint.update({
        where: { id: p.id },
        data: { ts: stamps[Math.min(i, stamps.length - 1)] },
      });
    }
  }

  return moved;
}

async function main() {
  const since = new Date(Date.now() - 60 * 1000);

  const reviewer = await upsertUser({
    username: "demo", email: REVIEWER_EMAIL, role: "USER",
    balance: 1000, password: REVIEWER_PASSWORD,
  });
  const mm1 = await upsertUser({ username: "quotes_north", email: "mm1@demo.invalid", role: "LIQUIDITY_PROVIDER", balance: 20000 });
  const mm2 = await upsertUser({ username: "quotes_south", email: "mm2@demo.invalid", role: "LIQUIDITY_PROVIDER", balance: 20000 });
  const makers = [mm1, mm2];
  const takers = [];
  for (const n of ["r_okafor", "j_lindqvist", "m_tanaka", "p_varga", "s_adeyemi"]) {
    takers.push(await upsertUser({ username: n, email: `${n}@demo.invalid`, role: "USER", balance: 5000 }));
  }
  console.log(`Users ready: ${reviewer.username} + 2 makers + ${takers.length} takers`);

  // Seeded rows are identified by a column, not by a marker inside text a
  // visitor reads. The old `<!-- __demo_seed_v2 -->` suffix on `description`
  // rendered verbatim under the title of every market on the public site.
  let created = [];
  const existing = await prisma.contract.findMany({ where: { isDemoSeed: true } });
  if (existing.length) {
    console.log(`Markets already present (${existing.length}) — reusing them.`);
    created = existing
      .map((c) => ({ contract: c, spec: MARKETS.find((m) => m.title === c.title) }))
      .filter((x) => x.spec);
    // Replace whatever book is resting with the current ladder, so a rerun
    // converges on one price grid instead of layering a second one over it.
    for (const { contract, spec } of created) {
      const cancelled = await clearSeedQuotes(contract.id, makers);
      const posted = await postLadder(contract.id, spec, makers);
      console.log(`  market ${contract.id}: ${cancelled} stale quotes cancelled, ${posted} reposted`);
    }
  }
  for (const [i, m] of created.length ? [] : MARKETS.entries()) {
    const contract = await prisma.contract.create({
      data: {
        title: m.title,
        description: m.description,
        status: "OPEN",
        minPrice: m.min,
        maxPrice: m.max,
        isDemoSeed: true,
        createdById: (i % 2 === 0 ? mm1 : mm2).id,
      },
    });
    const n = await postLadder(contract.id, m, makers);
    created.push({ contract, spec: m });
    console.log(`  market ${contract.id}: ${m.title.slice(0, 52)}… (${n} quotes across ${LEVELS} levels a side)`);
  }

  // Real orders, through the deployment's own API.
  const keys = [];
  for (const t of takers) keys.push({ user: t, key: await apiKeyFor(t.id) });

  console.log(`\nPlacing orders against ${APP_URL} …`);
  let filled = 0, rejected = 0;
  for (const { contract, spec } of created) {
    for (const [i, p] of tradePlan(spec).entries()) {
      const { user, key } = keys[(contract.id + i) % keys.length];
      const r = await placeOrder(key, {
        contractId: contract.id, type: "LIMIT", ...p,
      });
      if (r.status === 200 || r.status === 201) { filled++; }
      else { rejected++; console.log(`    ${user.username} ${p.side} ${p.size}@${p.limitPrice} -> ${r.status} ${r.body}`); }
    }
  }
  console.log(`\nOrders accepted: ${filled}, rejected: ${rejected}`);

  // Refresh the levels the orders ate into, the way a market maker would, so
  // the depth a visitor sees is not the leftovers of the seed run.
  let refreshed = 0;
  for (const { contract, spec } of created) {
    refreshed += await replenishLadder(contract.id, spec, makers);
  }
  console.log(`Books replenished to full depth (${refreshed} levels topped up).`);

  const moved = await spreadTape(created.map((c) => c.contract.id), since);
  console.log(`Tape spread over ${TAPE_HOURS}h: ${moved} fills restamped.`);

  for (const { contract } of created) {
    const n = await prisma.trade.count({ where: { contractId: contract.id } });
    console.log(`  market ${contract.id}: ${n} confirmed trades`);
  }
  console.log(`\nTrades in database: ${await prisma.trade.count()}`);
  console.log(`Reviewer login: ${REVIEWER_EMAIL} / ${REVIEWER_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
