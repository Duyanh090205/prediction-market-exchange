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
 *   SEED_MAKER_PASSWORD  optional. The script signs in as a seeded market maker
 *                        to settle a market through the app's own route, and
 *                        resets that account's password on every run. Left
 *                        unset it uses a fresh random one, which is what you
 *                        want: those accounts are LIQUIDITY_PROVIDERs and the
 *                        creators of the demo markets, so a password anyone can
 *                        read would let a stranger settle them at any value.
 *   TAPE_DAYS       how far back to spread the tape (default 4)
 *   SEED_RESET=1    delete this script's own markets and demo sandbox accounts
 *                   first, so the run produces one clean session instead of
 *                   layering a new tape over an older one. Never touches a
 *                   market or an account this script did not create.
 *   SEED_ALLOW_MISMATCH=1  proceed even when the database is local and the app
 *                   is remote, or the reverse
 *   SEED_ONLY_SETTLE=1  skip the open markets entirely and only run the settled
 *                   market step. Use it to finish a run that seeded the open
 *                   markets and then failed at settlement — rerunning the whole
 *                   script would trade the open markets a second time.
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
const TAPE_DAYS = Number(process.env.TAPE_DAYS || 4);
// No default: a literal here is a public credential for an account that can
// settle the demo markets. Random per run, used once, never printed.
const MAKER_PASSWORD = process.env.SEED_MAKER_PASSWORD || randomBytes(24).toString("base64url");
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

/**
 * Every account must satisfy the invariant the settlement route checks before
 * it commits: `balance` equals the sum of that user's BalanceLedger deltas.
 *
 * The seed used to set an opening balance directly and write no ledger row, so
 * seeded accounts were out of balance from the moment they existed and any
 * attempt to settle a seeded market aborted with a balance integrity mismatch.
 * Nothing surfaced it because nothing had ever settled one.
 */
async function reconcileOpeningBalance(user) {
  const agg = await prisma.balanceLedger.aggregate({
    where: { userId: user.id },
    _sum: { delta: true },
  });
  const ledgered = agg._sum.delta ?? 0;
  if (ledgered === user.balance) return false;
  await prisma.balanceLedger.create({
    data: {
      userId: user.id,
      delta: user.balance - ledgered,
      balanceAfter: user.balance,
      eventType: "INITIAL_SEED",
      note: "Seed opening balance",
    },
  });
  return true;
}

async function upsertUser({ username, email, role, balance, password }) {
  const hashedPassword = await bcrypt.hash(
    password || randomBytes(24).toString("base64url"),
    12
  );
  return prisma.user.upsert({
    where: { email },
    // Reset the password on a rerun too: the script signs in as a maker to
    // settle a market through the app's own route, so it has to know the
    // credential it created on a previous run.
    update: { status: "ACTIVE", ...(password ? { hashedPassword } : {}) },
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

/**
 * Sign in as a seeded account through the app's own NextAuth credentials
 * provider and return a cookie header.
 *
 * Settlement is cookie-authenticated (the /api/v1 bearer namespace does not
 * expose it), so the alternative was writing settled trades, P&L and ledger
 * rows into the database by hand. That would fabricate exactly the evidence
 * this deployment exists to demonstrate. This drives the real endpoint.
 */
async function loginAs(email, password) {
  const jar = new Map();
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  const csrfRes = await fetch(`${APP_URL}/api/auth/csrf`, { headers: { cookie: cookie() } });
  absorb(csrfRes);
  const { csrfToken } = await csrfRes.json();

  const res = await fetch(`${APP_URL}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: APP_URL,
      cookie: cookie(),
    },
    body: new URLSearchParams({ email, password, csrfToken, json: "true" }),
  });
  absorb(res);

  const header = cookie();
  if (!/session-token=/.test(header)) {
    const where = res.headers.get("location") || "(no redirect)";
    throw new Error(
      `sign-in failed for ${email}: status ${res.status}, redirected to ${where}`
    );
  }
  return header;
}

async function settleContract(cookie, contractId, settlementValue) {
  // Timed: settlement walks every open trade inside one transaction, so how
  // long it takes is a function of round-trip latency to the database. It is
  // the first thing to look at if this call ever comes back a bare 500.
  const startedAt = Date.now();
  const res = await fetch(`${APP_URL}/api/contracts/${contractId}/settle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: APP_URL,
      cookie,
      "Idempotency-Key": uuidv7(),
    },
    // No settlementValue in the body: the creator settles at the value they
    // locked at creation, and the route enforces that.
    body: JSON.stringify(settlementValue == null ? {} : { settlementValue }),
  });
  const text = await res.text();
  console.log(`  settle call: ${res.status} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return { status: res.status, body: text.slice(0, 240) };
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
const PATH = [
  1, -1, 2, 1, -2, 1, -1, 3, -1, 2,
  -2, 1, -1, 2, -1, 1, 2, -1, -2, 1,
  1, 2, -1, 1, -2, 2, 1, -1, 3, -2,
  -1, 1, 2, -1, 1, -3, 1, 2, -1, 1,
];
const SIZES = [
  4, 3, 2, 5, 3, 2, 4, 3, 2, 5,
  3, 4, 2, 3, 2, 6, 3, 4, 2, 5,
  2, 4, 3, 6, 2, 3, 5, 2, 4, 3,
  2, 5, 3, 2, 4, 3, 6, 2, 3, 4,
];

// Orders are described by how deep into the book they reach, not by an absolute
// price: the book is re-centred between rounds, so the price a given order pays
// depends on where the market had moved by then.
/**
 * One market's order flow. `variant` rotates the path and flips its direction
 * for some markets: running the same sequence everywhere had all five drifting
 * up in step, and two charts side by side gave away that one script wrote both.
 */
function tradePlan(variant = 0) {
  const n = PATH.length;
  const shift = (variant * 7) % n;
  const flip = variant % 3 === 1 ? -1 : 1;
  return PATH.map((_, i) => {
    const j = (i + shift) % n;
    const depth = PATH[j] * flip;
    return { side: depth > 0 ? "OVER" : "UNDER", size: SIZES[j], depth };
  });
}

// Trading happens in rounds. Between them the makers cancel and re-post around
// wherever the market got to, which is the only reason the price moves at all:
// with a static book every order fills at the same touch and the transaction
// chart comes out as a two-level square wave — visibly a script.
const ROUNDS = 8;

/**
 * Work the plan against `contract`, re-centring the book between rounds.
 * Returns { filled, rejected, mid } — the mid the market ended on.
 */
async function tradeSession(contract, spec, makers, keys, startMid, variant = 0) {
  const plan = tradePlan(variant);
  const per = Math.ceil(plan.length / ROUNDS);
  let mid = startMid;
  let filled = 0, rejected = 0;

  for (let r = 0; r < ROUNDS; r++) {
    // One pass while trading, so the touch is thin enough to be consumed and
    // the price walks within a round too. Full depth is restored at the end.
    await clearSeedQuotes(contract.id, makers);
    await postLadder(contract.id, { ...spec, mid }, makers, 1);

    let netOver = 0;
    for (const [i, p] of plan.slice(r * per, (r + 1) * per).entries()) {
      const { user, key } = keys[(contract.id + r * per + i) % keys.length];
      const limitPrice = mid + spec.tick * p.depth;
      const res = await placeOrder(key, {
        contractId: contract.id, type: "LIMIT", side: p.side, size: p.size, limitPrice,
      });
      if (res.status === 200 || res.status === 201) {
        filled++;
        netOver += p.side === "OVER" ? p.size : -p.size;
      } else {
        rejected++;
        console.log(`    ${user.username} ${p.side} ${p.size}@${limitPrice} -> ${res.status} ${res.body}`);
      }
    }

    // The makers follow the flow they just absorbed: bought into, they mark up.
    const step = netOver > 0 ? 1 : netOver < 0 ? -1 : 0;
    const next = mid + spec.tick * step;
    // Stay inside the band with room for six levels either side.
    const room = spec.tick * (LEVELS + 1);
    mid = Math.min(Math.max(next, spec.min + room), spec.max - room);
  }

  return { filled, rejected, mid };
}

const MARKETS = [
  {
    title: "How many home runs will be hit league-wide on opening day?",
    description:
      "Binary spread market. Quote a price you would both buy and sell at; settlement pays the distance between your fill and the true answer, capped at the contract size.",
    min: 0, max: 200, mid: 100, tick: 4, settlesInDays: 34,
  },
  {
    title: "Combined points in the Super Bowl",
    description: "Over/under on total points scored by both teams.",
    min: 0, max: 120, mid: 46, tick: 2, settlesInDays: 61,
  },
  {
    title: "US CPI year-over-year print, next release (basis points)",
    description: "Headline CPI YoY, quoted in basis points. 310 means 3.10%.",
    min: 0, max: 800, mid: 307, tick: 5, settlesInDays: 12,
  },
  {
    title: "Number of named Atlantic storms this season",
    description: "Settles on the final count published at end of season.",
    min: 0, max: 40, mid: 17, tick: 1, settlesInDays: 89,
  },
  {
    title: "US unemployment rate at the next release (basis points)",
    description:
      "Headline U-3 unemployment rate, quoted in basis points: 420 means 4.20%. The price band runs 300 to 700, not from zero — a contract only has to cover the outcomes anyone would trade, and the margin engine reserves against the worst case inside that band rather than against an impossible one.",
    min: 300, max: 700, mid: 420, tick: 5, settlesInDays: 26,
  },
];

// One market that has already run its course. It is the only place the
// settlement engine is visible from outside: a closing value, P&L realized
// against it on every position, and the balances and ledger entries that moved
// with them. It is settled through the app's own route by the account that
// created it, at the result that account locked at creation — so the integrity
// rule (commit the outcome before you can see the positions) is exercised too,
// not just described.
const SETTLED_MARKET = {
  title: "US CPI year-over-year print, July 2026 release (basis points)",
  description:
    "Headline CPI YoY, quoted in basis points. 310 means 3.10%. Closed on the BLS release; the creator committed the settlement value at creation and could not change it afterwards.",
  min: 0, max: 800, mid: 296, tick: 4,
  lockedResult: 289,
  // Traded over this window, then settled at the end of it.
  tradedDaysAgo: 11,
  settledDaysAgo: 6,
};

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

async function postLadder(contractId, spec, makers, passes = LADDER_PASSES) {
  const levels = ladder(spec);
  let posted = 0;
  for (let pass = 0; pass < passes; pass++) {
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
  // Anything resting away from the final grid is left over from an earlier
  // round at an older mid; cancel it so the displayed book is one clean ladder.
  const keep = new Set(levels.flatMap((l) => [l.bid, l.ask]));
  const stale = await prisma.quote.findMany({
    where: { contractId, status: "OPEN", makerId: { in: makers.map((m) => m.id) } },
    select: { id: true, bid: true, ask: true },
  });
  const staleIds = stale
    .filter((q) => (q.bid != null && !keep.has(q.bid)) || (q.ask != null && !keep.has(q.ask)))
    .map((q) => q.id);
  if (staleIds.length) {
    await prisma.quote.updateMany({
      where: { id: { in: staleIds } },
      data: { status: "CANCELLED" },
    });
  }
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
 * Spread this run's fills back over a window, preserving their order.
 *
 * Only the timestamps move. Every order in this script executes within the
 * minute it runs, so without this the whole price history sits inside a few
 * seconds — a chart whose x-axis spans 3:48:22 to 3:48:26 is a screenshot of a
 * seed script, not of a market. The prices, sizes and counterparties are
 * whatever the engine produced.
 *
 * @param endMs when the last print should land (default: a few minutes ago)
 * @param days  how far back the first print should reach
 */
async function spreadTape(contractIds, since, { days = TAPE_DAYS, endMs = null } = {}) {
  const windowMs = days * 24 * 60 * 60 * 1000;
  let moved = 0;

  for (const contractId of contractIds) {
    const trades = await prisma.trade.findMany({
      where: { contractId, createdAt: { gte: since } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (trades.length === 0) continue;

    // Even spacing with jitter, ending before now so the last print does not
    // sit exactly on the seed time.
    const end = endMs ?? Date.now() - 4 * 60 * 1000;
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

/**
 * Create, trade and settle the one market that has already run its course.
 *
 * Everything goes through the running app: the orders through the bearer API,
 * the settlement through the cookie-authenticated settle route as the account
 * that created the market, at the value that account locked at creation. The
 * P&L on each trade, the balance movements and the ledger rows are the engine's
 * own output. Only two timestamps are rewritten afterwards — the tape and the
 * settlement stamp — for the same reason the open markets' tape is rewritten.
 */
async function seedSettledMarket({ makers, keys, since }) {
  const spec = SETTLED_MARKET;
  const found = await prisma.contract.findFirst({ where: { title: spec.title } });
  if (found && found.status === "SETTLED") {
    const n = await prisma.trade.count({ where: { contractId: found.id } });
    console.log(`Settled market already present: #${found.id} at ${found.settlementValue} (${n} trades).`);
    return;
  }

  // Resume: a previous run may have created and traded this market and then
  // failed at the settle call, which rolls back cleanly and leaves the market
  // OPEN with its tape already in place. Re-running the orders would double it.
  if (found && found.status === "OPEN") {
    const existingTrades = await prisma.trade.count({ where: { contractId: found.id } });
    if (existingTrades >= PATH.length / 2) {
      console.log(
        `Settled market: #${found.id} already has ${existingTrades} trades — settling only.`
      );
      const cookie = await loginAs(makers[0].email, MAKER_PASSWORD);
      const res = await settleContract(cookie, found.id, null);
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`settle failed: ${res.status} ${res.body}`);
      }
      await prisma.contract.update({
        where: { id: found.id },
        data: { settledAt: daysAgo(spec.settledDaysAgo) },
      });
      const after = await prisma.contract.findUnique({
        where: { id: found.id },
        select: { status: true, settlementValue: true },
      });
      const paid = await prisma.balanceLedger.count({
        where: { contractId: found.id, eventType: "SETTLEMENT" },
      });
      console.log(
        `Settled market ${found.id}: ${after.status} at ${after.settlementValue} · ` +
        `${existingTrades} trades · ${paid} ledger entries written`
      );
      return;
    }
  }

  const creator = makers[0];
  const contract =
    found ??
    (await prisma.contract.create({
      data: {
        title: spec.title,
        description: spec.description,
        status: "OPEN",
        minPrice: spec.min,
        maxPrice: spec.max,
        isDemoSeed: true,
        lockedResult: spec.lockedResult,
        settlesAt: daysAgo(spec.settledDaysAgo),
        createdById: creator.id,
      },
    }));

  // A different variant again, so the settled market does not retrace the
  // shape of an open one.
  const { filled, rejected } = await tradeSession(contract, spec, makers, keys, spec.mid, 4);

  // The tape has to sit before the settlement, not around now.
  const settledAt = daysAgo(spec.settledDaysAgo);
  const moved = await spreadTape([contract.id], since, {
    days: Math.max(1, spec.tradedDaysAgo - spec.settledDaysAgo),
    endMs: settledAt.getTime() - 60 * 60 * 1000,
  });

  const cookie = await loginAs(creator.email, MAKER_PASSWORD);
  // No value passed: the route settles at the creator's locked result and
  // rejects anything else, which is the property worth demonstrating.
  const res = await settleContract(cookie, contract.id, null);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`settle failed: ${res.status} ${res.body}`);
  }
  await prisma.contract.update({
    where: { id: contract.id },
    data: { settledAt },
  });

  const after = await prisma.contract.findUnique({
    where: { id: contract.id },
    select: { status: true, settlementValue: true },
  });
  const trades = await prisma.trade.count({ where: { contractId: contract.id } });
  const paid = await prisma.balanceLedger.count({
    where: { contractId: contract.id, eventType: "SETTLEMENT" },
  });
  console.log(
    `Settled market ${contract.id}: ${after.status} at ${after.settlementValue} · ` +
    `${trades} trades (${filled} orders accepted, ${rejected} rejected, ${moved} restamped) · ` +
    `${paid} ledger entries written`
  );
}

/**
 * Delete everything this script has ever created, so a rerun produces one clean
 * session instead of layering a new tape over an old one. Opt-in: SEED_RESET=1.
 *
 * Touches only rows this script owns — contracts flagged isDemoSeed, the demo
 * sandbox accounts, and the seeded users' balances. Real accounts, and any
 * market a real account created, are left alone.
 */
async function resetSeedData(seedUsers) {
  const contracts = await prisma.contract.findMany({
    where: { isDemoSeed: true },
    select: { id: true },
  });
  const ids = contracts.map((c) => c.id);
  if (ids.length) {
    await prisma.$transaction([
      prisma.trade.deleteMany({ where: { contractId: { in: ids } } }),
      prisma.quote.deleteMany({ where: { contractId: { in: ids } } }),
      prisma.pricePoint.deleteMany({ where: { contractId: { in: ids } } }),
      prisma.hint.deleteMany({ where: { contractId: { in: ids } } }),
      prisma.message.deleteMany({ where: { contractId: { in: ids } } }),
      prisma.contract.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }

  // Demo sandbox accounts only ever traded the markets just removed, so nothing
  // points at them any more.
  const demos = await prisma.user.findMany({ where: { isDemo: true }, select: { id: true } });
  const demoIds = demos.map((d) => d.id);
  if (demoIds.length) {
    await prisma.$transaction([
      prisma.contract.updateMany({
        where: { createdById: { in: demoIds } },
        data: { createdById: null },
      }),
      prisma.trade.deleteMany({
        where: { OR: [{ takerId: { in: demoIds } }, { makerId: { in: demoIds } }] },
      }),
      prisma.quote.deleteMany({ where: { makerId: { in: demoIds } } }),
      prisma.hint.deleteMany({ where: { authorId: { in: demoIds } } }),
      prisma.message.deleteMany({
        where: { OR: [{ userId: { in: demoIds } }, { recipientId: { in: demoIds } }] },
      }),
      prisma.notification.deleteMany({ where: { userId: { in: demoIds } } }),
      prisma.balanceLedger.deleteMany({ where: { userId: { in: demoIds } } }),
      prisma.apiKey.deleteMany({ where: { userId: { in: demoIds } } }),
      prisma.user.deleteMany({ where: { id: { in: demoIds } } }),
    ]);
  }

  // Seeded players go back to their opening balance, with the ledger cleared so
  // reconcileOpeningBalance writes one fresh INITIAL_SEED row for each.
  const ownerIds = seedUsers.map((s) => s.user.id);
  await prisma.balanceLedger.deleteMany({ where: { userId: { in: ownerIds } } });
  for (const { user, opening } of seedUsers) {
    await prisma.user.update({ where: { id: user.id }, data: { balance: opening } });
    user.balance = opening;
  }

  return { contracts: ids.length, demoAccounts: demoIds.length };
}

const c_isOpen = (c) => c.status === "OPEN";
const daysFromNow = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

/** Host and database name only — never the credentials. */
function describeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable TRADING_DATABASE_URL)";
  }
}

async function main() {
  const since = new Date(Date.now() - 60 * 1000);

  // This script writes quotes to one place and sends orders to another. Getting
  // those two out of step is the expensive mistake — seeding a local database
  // while trading against production, or the reverse — so say what they are and
  // refuse the obvious mismatch.
  const dbUrl = process.env.TRADING_DATABASE_URL || "";
  const dbTarget = describeTarget(dbUrl);
  const dbIsLocal = /localhost|127\.0\.0\.1/.test(dbUrl);
  const appIsLocal = /localhost|127\.0\.0\.1/.test(APP_URL);
  console.log(`Database: ${dbTarget}`);
  console.log(`App:      ${APP_URL}`);
  if (dbIsLocal !== appIsLocal && process.env.SEED_ALLOW_MISMATCH !== "1") {
    console.error(
      `
Refusing to run: the database is ${dbIsLocal ? "local" : "remote"} but the app is ` +
      `${appIsLocal ? "local" : "remote"}. Orders would execute against a different dataset ` +
      `than the one being seeded. Set SEED_ALLOW_MISMATCH=1 if this is deliberate.`
    );
    process.exitCode = 1;
    return;
  }

  const reviewer = await upsertUser({
    username: "demo", email: REVIEWER_EMAIL, role: "USER",
    balance: 1000, password: REVIEWER_PASSWORD,
  });
  const mm1 = await upsertUser({ username: "quotes_north", email: "mm1@demo.invalid", role: "LIQUIDITY_PROVIDER", balance: 20000, password: MAKER_PASSWORD });
  const mm2 = await upsertUser({ username: "quotes_south", email: "mm2@demo.invalid", role: "LIQUIDITY_PROVIDER", balance: 20000, password: MAKER_PASSWORD });
  const makers = [mm1, mm2];
  const takers = [];
  for (const n of ["r_okafor", "j_lindqvist", "m_tanaka", "p_varga", "s_adeyemi"]) {
    takers.push(await upsertUser({ username: n, email: `${n}@demo.invalid`, role: "USER", balance: 5000 }));
  }
  const seedUsers = [
    { user: reviewer, opening: 1000 },
    { user: mm1, opening: 20000 },
    { user: mm2, opening: 20000 },
    ...takers.map((t) => ({ user: t, opening: 5000 })),
  ];

  if (process.env.SEED_RESET === "1") {
    const wiped = await resetSeedData(seedUsers);
    console.log(
      `Reset: removed ${wiped.contracts} seeded markets and ${wiped.demoAccounts} demo sandbox accounts.`
    );
  }

  let seeded = 0;
  for (const { user } of seedUsers) {
    if (await reconcileOpeningBalance(user)) seeded++;
  }
  console.log(
    `Users ready: ${reviewer.username} + 2 makers + ${takers.length} takers ` +
    `(${seeded} opening-balance ledger entries written)`
  );

  if (process.env.SEED_ONLY_SETTLE === "1") {
    await seedSettledMarket({ makers, keys: [], since });
    return;
  }

  // Seeded rows are identified by a column, not by a marker inside text a
  // visitor reads. The old `<!-- __demo_seed_v2 -->` suffix on `description`
  // rendered verbatim under the title of every market on the public site.
  let created = [];
  const existing = (await prisma.contract.findMany({ where: { isDemoSeed: true } }))
    .filter(c_isOpen);
  if (existing.length) {
    console.log(`Markets already present (${existing.length}) — reusing them.`);
    created = existing
      .map((c) => ({ contract: c, spec: MARKETS.find((m) => m.title === c.title) }))
      .filter((x) => x.spec);
    // Markets seeded before settlesAt existed have no date on them.
    for (const { contract, spec } of created) {
      if (!contract.settlesAt) {
        await prisma.contract.update({
          where: { id: contract.id },
          data: { settlesAt: daysFromNow(spec.settlesInDays) },
        });
      }
    }
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
        settlesAt: daysFromNow(m.settlesInDays),
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
  const finalMid = new Map();
  for (const [i, { contract, spec }] of created.entries()) {
    const r = await tradeSession(contract, spec, makers, keys, spec.mid, i);
    filled += r.filled;
    rejected += r.rejected;
    finalMid.set(contract.id, r.mid);
  }
  console.log(`\nOrders accepted: ${filled}, rejected: ${rejected}`);

  // Restore full depth around wherever each market ended up, the way a market
  // maker would. The book a visitor sees should be the current one, not the
  // leftovers of the last round.
  let refreshed = 0;
  for (const { contract, spec } of created) {
    refreshed += await replenishLadder(
      contract.id,
      { ...spec, mid: finalMid.get(contract.id) ?? spec.mid },
      makers
    );
  }
  console.log(`Books replenished to full depth (${refreshed} levels topped up).`);

  const moved = await spreadTape(created.map((c) => c.contract.id), since);
  console.log(`Tape spread over ${TAPE_DAYS}d: ${moved} fills restamped.`);

  await seedSettledMarket({ makers, keys, since });

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
