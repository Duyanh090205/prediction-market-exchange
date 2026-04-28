// LOCAL-ONLY end-to-end smoke test.
//
// Exercises every flow that production traffic will hit:
//   1. Pending-registration → admin approval → login
//   2. CSRF guards on state-changing endpoints
//   3. Quote post (with margin + price-band check)
//   4. LIMIT order matching (Double Margining)
//   5. MARKET order book sweep
//   6. Settlement with integrity check
//   7. Admin actions: suspend, adjust_balance, audit log
//
// Prints PASS/FAIL per step; non-zero exit on any failure.

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run in production.");
  process.exit(1);
}

require("dotenv").config({ path: ".env.local" });
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");

const BASE = "http://localhost:3000";
const ORIGIN = process.env.NEXTAUTH_URL || BASE;

const prisma = new PrismaClient();
let pass = 0;
let fail = 0;
const failures = [];

function uuidv7() {
  // RFC 9562 §5.7 — minimal UUIDv7 generator (timestamp + random).
  const ms = BigInt(Date.now());
  const high = (ms >> 16n).toString(16).padStart(12, "0");
  const low = (ms & 0xffffn).toString(16).padStart(4, "0");
  const r1 = Math.floor(Math.random() * 0x1000)
    .toString(16)
    .padStart(3, "0");
  const r2 = (8 + Math.floor(Math.random() * 4)).toString(16); // variant bits
  const r3 = Math.floor(Math.random() * 0x1000)
    .toString(16)
    .padStart(3, "0");
  const r4 = randomUUID().replace(/-/g, "").slice(-12);
  return `${high.slice(0, 8)}-${high.slice(8, 12)}-7${r1}-${r2}${r3}-${r4}`;
}

function ok(name) {
  pass++;
  console.log(`  PASS  ${name}`);
}
function ko(name, detail) {
  fail++;
  failures.push({ name, detail });
  console.log(`  FAIL  ${name}`);
  if (detail) console.log("        ", detail);
}

async function J(res) {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function http(method, path, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    Origin: ORIGIN,
    ...(opts.cookies ? { Cookie: opts.cookies } : {}),
    ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  return res;
}

function setCookies(prevCookies, response) {
  const map = new Map();
  if (prevCookies) {
    prevCookies.split("; ").forEach((kv) => {
      const i = kv.indexOf("=");
      if (i > 0) map.set(kv.slice(0, i), kv.slice(i + 1));
    });
  }
  // Node fetch returns set-cookie via getSetCookie() (Node 20+).
  const setCookie = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.raw && response.headers.raw()["set-cookie"]) || [];
  for (const sc of setCookie) {
    const first = sc.split(";")[0];
    const i = first.indexOf("=");
    if (i > 0) map.set(first.slice(0, i), first.slice(i + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function loginAs(email, password) {
  // 1. Get CSRF token.
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { redirect: "manual" });
  const csrfBody = await csrfRes.json();
  const cookies1 = setCookies("", csrfRes);
  // 2. POST credentials.
  const form = new URLSearchParams({
    csrfToken: csrfBody.csrfToken,
    email,
    password,
    callbackUrl: BASE,
    redirect: "false",
    json: "true",
  });
  const cbRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies1,
      Origin: ORIGIN,
    },
    body: form.toString(),
    redirect: "manual",
  });
  const cookies2 = setCookies(cookies1, cbRes);
  return { cookies: cookies2, status: cbRes.status };
}

async function main() {
  console.log("\n=== Smoke test ===\n");

  // ── 0. Clean slate: drop test artifacts from prior runs and reset state. ──
  // Delete users from previous smoke runs (anyone with email starting "pending-").
  const testUsers = await prisma.user.findMany({ where: { email: { startsWith: "pending-" } } });
  if (testUsers.length > 0) {
    const ids = testUsers.map((u) => u.id);
    await prisma.balanceLedger.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.adminAuditLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.contract.deleteMany({});
  await prisma.balanceLedger.deleteMany({});

  const seedUsers = await prisma.user.findMany();
  if (seedUsers.every((u) => u.status === "ACTIVE")) ok("seeded users ACTIVE");
  else ko("seeded users ACTIVE", JSON.stringify(seedUsers.map((u) => ({ u: u.username, s: u.status }))));

  for (const u of seedUsers) {
    const bal = u.username === "sam" ? 10000 : 1000;
    await prisma.user.update({ where: { id: u.id }, data: { balance: bal, status: "ACTIVE" } });
    await prisma.balanceLedger.create({
      data: { userId: u.id, delta: bal, balanceAfter: bal, eventType: "INITIAL_SEED", note: "smoke-test seed" },
    });
  }

  // ── 1. CSRF guard on /api/auth/register (no Origin) — public route ───────
  const noOrigin = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "x", email: "x@y.z", password: "12345678" }),
    redirect: "manual",
  });
  if (noOrigin.status === 403) ok("CSRF: rejects POST without Origin");
  else ko("CSRF: rejects POST without Origin", `got ${noOrigin.status}`);

  // ── 2. Register a PENDING user ─────────────────────────────────────────────
  const newEmail = `pending-${Date.now()}@test.local`;
  const newUsername = `pend${Math.floor(Math.random() * 1e6)}`;
  const reg = await http("POST", "/api/auth/register", {
    body: { username: newUsername, email: newEmail, password: "testpass123" },
  });
  const regJ = await J(reg);
  if (reg.status === 201) ok("register: 201 created PENDING");
  else ko("register: 201 created PENDING", `${reg.status} ${JSON.stringify(regJ.body)}`);

  const pendingUser = await prisma.user.findUnique({ where: { email: newEmail } });
  if (pendingUser?.status === "PENDING" && pendingUser.balance === 0)
    ok("register: persisted as PENDING with 0 balance");
  else ko("register: persisted as PENDING with 0 balance", JSON.stringify(pendingUser));

  // ── 3. PENDING user cannot log in ─────────────────────────────────────────
  const loginPending = await loginAs(newEmail, "testpass123");
  const sessRes = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: loginPending.cookies, Origin: ORIGIN } });
  const sessText = await sessRes.text();
  let sessJ;
  try { sessJ = JSON.parse(sessText); } catch { sessJ = null; }
  if (!sessJ || !sessJ.user) ok("login: PENDING user cannot establish session");
  else ko("login: PENDING user cannot establish session", JSON.stringify(sessJ));

  // ── 4. Login as admin ─────────────────────────────────────────────────────
  const adminLogin = await loginAs("admin@iterlight.com", "testpass123");
  const adminSessRes = await fetch(`${BASE}/api/auth/session`, {
    headers: { Cookie: adminLogin.cookies, Origin: ORIGIN },
  });
  const adminSessText = await adminSessRes.text();
  let adminSess;
  try {
    adminSess = JSON.parse(adminSessText);
  } catch {
    adminSess = null;
  }
  if (adminSess?.user?.role === "ADMIN") ok("login: admin session active");
  else
    ko(
      "login: admin session active",
      `loginStatus=${adminLogin.status} sessionStatus=${adminSessRes.status} body=${adminSessText.slice(0, 200)}`
    );
  const adminCookies = adminLogin.cookies;

  // ── 5. Admin approves the PENDING user ────────────────────────────────────
  const approve = await http("PATCH", `/api/admin/users/${pendingUser.id}`, {
    cookies: adminCookies,
    body: { action: "approve", balance: 1000 },
  });
  const approveJ = await J(approve);
  if (approve.status === 200) ok("admin: approve PENDING user");
  else ko("admin: approve PENDING user", `${approve.status} ${JSON.stringify(approveJ.body)}`);

  const approvedUser = await prisma.user.findUnique({ where: { email: newEmail } });
  if (approvedUser?.status === "ACTIVE" && approvedUser.balance === 1000)
    ok("admin: user transitioned ACTIVE with balance");
  else ko("admin: user transitioned ACTIVE with balance", JSON.stringify(approvedUser));

  // ── 6. AdminAuditLog has APPROVE_USER row ─────────────────────────────────
  const auditApprove = await prisma.adminAuditLog.findFirst({
    where: { action: "APPROVE_USER", targetUserId: pendingUser.id },
  });
  if (auditApprove) ok("audit: APPROVE_USER recorded");
  else ko("audit: APPROVE_USER recorded");

  // ── 7. New ACTIVE user can now log in ─────────────────────────────────────
  const newLogin = await loginAs(newEmail, "testpass123");
  const newSess = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: newLogin.cookies, Origin: ORIGIN } })).json();
  if (newSess.user?.id) ok("login: approved user can now sign in");
  else ko("login: approved user can now sign in", JSON.stringify(newSess));

  // ── 8. Admin creates a contract with price band 0–100 ─────────────────────
  const create = await http("POST", "/api/contracts", {
    cookies: adminCookies,
    body: { title: "Smoke contract", description: "Smoke test", minPrice: 0, maxPrice: 100 },
  });
  const createJ = await J(create);
  if (create.status === 201 && createJ.body.contract?.minPrice === 0 && createJ.body.contract?.maxPrice === 100)
    ok("contract: created with price band");
  else ko("contract: created with price band", `${create.status} ${JSON.stringify(createJ.body)}`);
  const contractId = createJ.body.contract?.id;

  // ── 9. Login as Sam (LP) and post a quote ─────────────────────────────────
  const samLogin = await loginAs("sam@iterlight.com", "testpass123");
  const samCookies = samLogin.cookies;
  const samSess = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: samCookies, Origin: ORIGIN } })).json();
  if (samSess.user?.role === "LIQUIDITY_PROVIDER") ok("login: sam (LP) session active");
  else ko("login: sam (LP) session active", JSON.stringify(samSess));

  // ── 10. Quote with bid > maxPrice should be rejected ──────────────────────
  const badQuote = await http("POST", "/api/quotes", {
    cookies: samCookies,
    body: { contractId, bid: 50, ask: 200, size: 10 },
  });
  if (badQuote.status === 400) ok("quote: rejects ask outside price band");
  else ko("quote: rejects ask outside price band", `${badQuote.status} ${JSON.stringify((await J(badQuote)).body)}`);

  // ── 11. Valid quote ──────────────────────────────────────────────────────
  const goodQuote = await http("POST", "/api/quotes", {
    cookies: samCookies,
    body: { contractId, bid: 40, ask: 60, size: 50 },
  });
  const goodQuoteJ = await J(goodQuote);
  if (goodQuote.status === 201) ok("quote: posted with bid/ask in band");
  else ko("quote: posted with bid/ask in band", `${goodQuote.status} ${JSON.stringify(goodQuoteJ.body)}`);
  const quoteId = goodQuoteJ.body.quote?.id;

  // ── 12. Quote that exceeds maker margin is rejected ───────────────────────
  const oversize = await http("POST", "/api/quotes", {
    cookies: samCookies,
    body: { contractId, bid: 10, ask: 90, size: 100000 },
  });
  if (oversize.status === 422) ok("quote: rejects size exceeding maker margin");
  else ko("quote: rejects size exceeding maker margin", `${oversize.status} ${JSON.stringify((await J(oversize)).body)}`);

  // ── 13. Login as Ivan and place LIMIT order against Sam's quote ───────────
  const ivanLogin = await loginAs("ivan@iterlight.com", "testpass123");
  const ivanCookies = ivanLogin.cookies;
  const limit = await http("POST", "/api/orders", {
    cookies: ivanCookies,
    idempotencyKey: uuidv7(),
    body: { contractId, type: "LIMIT", side: "OVER", size: 10, quoteId },
  });
  const limitJ = await J(limit);
  if (limit.status === 200 && limitJ.body.totalFilled === 10) ok("order: LIMIT executed instantly");
  else ko("order: LIMIT executed instantly", `${limit.status} ${JSON.stringify(limitJ.body)}`);

  // ── 14. Idempotency replay returns same response ──────────────────────────
  const idemKey = uuidv7();
  const first = await http("POST", "/api/orders", {
    cookies: ivanCookies,
    idempotencyKey: idemKey,
    body: { contractId, type: "LIMIT", side: "OVER", size: 5, quoteId },
  });
  const second = await http("POST", "/api/orders", {
    cookies: ivanCookies,
    idempotencyKey: idemKey,
    body: { contractId, type: "LIMIT", side: "OVER", size: 5, quoteId },
  });
  const firstJ = await J(first);
  const secondJ = await J(second);
  const tradesAfterReplay = await prisma.trade.count({ where: { contractId } });
  if (tradesAfterReplay === 2 && JSON.stringify(firstJ.body) === JSON.stringify(secondJ.body))
    ok("idempotency: replay returns cached response, no duplicate trade");
  else
    ko(
      "idempotency: replay returns cached response, no duplicate trade",
      `tradesAfterReplay=${tradesAfterReplay} firstStatus=${first.status} secondStatus=${second.status}`
    );

  // ── 15. MARKET sweep ──────────────────────────────────────────────────────
  // Add a second LP-style quote so MARKET can sweep multiple levels.
  await http("POST", "/api/quotes", {
    cookies: samCookies,
    body: { contractId, bid: 30, ask: 70, size: 20 },
  });
  const market = await http("POST", "/api/orders", {
    cookies: ivanCookies,
    idempotencyKey: uuidv7(),
    body: { contractId, type: "MARKET", side: "OVER", size: 15, limitPrice: 80 },
  });
  const marketJ = await J(market);
  if (market.status === 200 && marketJ.body.totalFilled > 0) ok("order: MARKET sweep filled");
  else ko("order: MARKET sweep filled", `${market.status} ${JSON.stringify(marketJ.body)}`);

  // ── 16. limitPrice outside contract band is rejected ──────────────────────
  const outOfBand = await http("POST", "/api/orders", {
    cookies: ivanCookies,
    idempotencyKey: uuidv7(),
    body: { contractId, type: "MARKET", side: "OVER", size: 5, limitPrice: 999 },
  });
  if (outOfBand.status === 400) ok("order: rejects limitPrice outside band");
  else ko("order: rejects limitPrice outside band", `${outOfBand.status} ${JSON.stringify((await J(outOfBand)).body)}`);

  // ── 17. Settle contract ───────────────────────────────────────────────────
  const settle = await http("POST", `/api/contracts/${contractId}/settle`, {
    cookies: adminCookies,
    idempotencyKey: uuidv7(),
    body: { settlementValue: 75 },
  });
  const settleJ = await J(settle);
  if (settle.status === 200 && settleJ.body.success) ok("settle: contract settled");
  else ko("settle: contract settled", `${settle.status} ${JSON.stringify(settleJ.body)}`);

  // ── 18. Balance integrity holds ──────────────────────────────────────────
  const allUsers = await prisma.user.findMany({ select: { id: true, balance: true } });
  let mismatch = false;
  for (const u of allUsers) {
    const sum = await prisma.balanceLedger.aggregate({ where: { userId: u.id }, _sum: { delta: true } });
    if ((sum._sum.delta ?? 0) !== u.balance) {
      mismatch = true;
      console.log(`        user=${u.id} balance=${u.balance} ledgerSum=${sum._sum.delta}`);
    }
  }
  if (!mismatch) ok("settle: balance integrity holds (balance == ledger sum)");
  else ko("settle: balance integrity holds (balance == ledger sum)");

  // ── 19. Audit log: SETTLE_CONTRACT row exists ─────────────────────────────
  const auditSettle = await prisma.adminAuditLog.findFirst({
    where: { action: "SETTLE_CONTRACT", targetId: contractId },
  });
  if (auditSettle) ok("audit: SETTLE_CONTRACT recorded");
  else ko("audit: SETTLE_CONTRACT recorded");

  // ── 20. Admin balance adjust ─────────────────────────────────────────────
  const adjust = await http("PATCH", `/api/admin/users/${pendingUser.id}`, {
    cookies: adminCookies,
    body: { action: "adjust_balance", delta: -50, reason: "smoke test penalty" },
  });
  if (adjust.status === 200) ok("admin: adjust_balance");
  else ko("admin: adjust_balance", `${adjust.status} ${JSON.stringify((await J(adjust)).body)}`);

  // ── 21. Suspend then reactivate ───────────────────────────────────────────
  const suspend = await http("PATCH", `/api/admin/users/${pendingUser.id}`, {
    cookies: adminCookies,
    body: { action: "suspend" },
  });
  const reactivate = await http("PATCH", `/api/admin/users/${pendingUser.id}`, {
    cookies: adminCookies,
    body: { action: "reactivate" },
  });
  if (suspend.status === 200 && reactivate.status === 200) ok("admin: suspend → reactivate cycle");
  else ko("admin: suspend → reactivate cycle", `suspend=${suspend.status} reactivate=${reactivate.status}`);

  // ── 22. Audit log endpoint accessible ─────────────────────────────────────
  const auditList = await fetch(`${BASE}/api/admin/audit-log?limit=10`, { headers: { Cookie: adminCookies, Origin: ORIGIN } });
  const auditListJ = await auditList.json();
  if (auditList.status === 200 && Array.isArray(auditListJ.entries)) ok("audit: GET /api/admin/audit-log");
  else ko("audit: GET /api/admin/audit-log", `${auditList.status}`);

  // ── 23. Non-admin cannot reach admin endpoints ────────────────────────────
  const forbidden = await fetch(`${BASE}/api/admin/users`, { headers: { Cookie: ivanCookies, Origin: ORIGIN } });
  if (forbidden.status === 403) ok("rbac: non-admin blocked from /api/admin/users");
  else ko("rbac: non-admin blocked from /api/admin/users", `got ${forbidden.status}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n  ${pass} passed, ${fail} failed.\n`);
  if (fail > 0) {
    console.log("Failed steps:");
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  }
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Smoke test crashed:", err);
  await prisma.$disconnect();
  process.exit(2);
});
