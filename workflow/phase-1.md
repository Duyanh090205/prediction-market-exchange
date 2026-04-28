# Phase 1 — Trading Game Platform (MVP)

**Goal**: Production-grade prediction-market trading platform with instant CLOB matching, admin-gated registration, and horizontal-scale-ready infrastructure.
**Stack**: Next.js 15 App Router · Prisma ORM · PostgreSQL · NextAuth v5 · Socket.IO · Optional Redis (rate limiter + WS adapter) · DigitalOcean App Platform
**Status**: ✅ Phase 1 Complete

---

## CP-1: Project Scaffold + Schema + Auth ✅

- Next.js App Router (TypeScript, ESLint) — App Router only, no `pages/`
- Dependencies: `prisma`, `@prisma/client`, `next-auth@5`, `bcryptjs`, `jose`, `uuid`, `socket.io`, `socket.io-client`
- Security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP (dev/prod split), HSTS in prod
- Prisma schema — 11 tables: User, Contract, Quote, Trade, Hint, Notification, NotificationArchive, BalanceLedger, IdempotencyKey, PasswordResetToken, AdminAuditLog
- NextAuth v5 Credentials provider — session exposes `user.id`, `user.role`, `user.username`
- Session re-validation cached 30 s — `token.lastChecked` gates a DB lookup; deletion / suspension / role change propagates within 30 s
- Session duration 7 days · Password ≥ 8 chars · bcrypt factor 12
- `lib/rate-limiter.ts` — pluggable backend; in-memory by default, Redis when `REDIS_URL` set. Login (10/15 min/IP) and Register (5/h/IP) scopes
- `lib/csrf.ts` — strict origin: requires Origin OR Referer matching NEXTAUTH_URL; refuses if NEXTAUTH_URL unset; Content-Type: application/json for POST/PUT/PATCH
- `lib/logger.ts` — structured logging (method, path, userId, statusCode, processingTimeMs) + `sanitizeBodyForLog` for redacted error context
- `lib/audit.ts` — `logAdminAction` helper, optional Prisma transaction client, captures admin / action / target / metadata / IP

---

## CP-2: Seed + Account Lifecycle ✅

- `prisma/seed.ts` — bootstrap accounts (Sam LP / Admin / sample USERs)
- All passwords bcrypt (factor 12)
- BalanceLedger `INITIAL_SEED` row written atomically with the User row (transaction)
- **Admin-gated public registration:** `POST /api/auth/register` creates `status=PENDING` with balance=0; PENDING users are blocked at the credentials provider
- Admin lifecycle actions on `PATCH /api/admin/users/[id]`:
  - `approve` — flips PENDING → ACTIVE, grants starting balance, writes INITIAL_SEED ledger, audit log, user notification
  - `deny` — hard-deletes a PENDING registration with audit log
  - `suspend` / `reactivate` — ACTIVE ↔ SUSPENDED, audit logged
  - `adjust_balance` — manual ± delta with mandatory reason; writes ADMIN_ADJUSTMENT ledger entry
- `POST /api/admin/users` — admin-create flow (skips approval queue) writes INITIAL_SEED + AdminAuditLog
- `GET /api/admin/audit-log?action=…&targetType=…` — filterable audit history
- `app/admin/page.tsx` — Pending Approvals card highlighted when count > 0, Recent Admin Actions feed
- `app/admin/users/page.tsx` — Pending queue + ACTIVE/SUSPENDED management
- `app/admin/audit-log/page.tsx` — full filterable audit log table

---

## CP-3: Contract & Quote APIs + Market UI ✅

- `Contract.minPrice / maxPrice` per-contract price band (default 0–100)
- `GET/POST /api/contracts` — list OPEN; create requires Admin or LP, validates band integers and `min < max`
- `GET /api/contracts/[id]` — full detail: quotes, hints, OPEN trades
- `DELETE /api/contracts/[id]` — Admin only, OPEN contracts only, refused if any trades exist; audited
- `POST /api/quotes` — USER or LP only (Admin blocked). Validates `bid < ask`, integers in price band, **maker margin check** (rejects 422 if margin < quote size)
- `PATCH /api/quotes/[id]` — maker only, re-validates price band; if size grows, requires additional margin headroom
- `DELETE /api/quotes/[id]` — maker OR Admin; admin cancellation notifies maker and writes CANCEL_QUOTE audit
- Market page two-column layout: LP quote prominent left, player quotes right, OPEN trades below; price band visible in header
- Components: `ContractCard`, `QuoteCard` (prominent + regular), `PostQuoteForm`, `QuoteActions` — all consume per-contract `minPrice/maxPrice` props

---

## CP-4: Hints ✅

- `POST /api/hints` — LP and Admin only
- `PATCH /api/hints/[id]` — author only
- `DELETE /api/hints/[id]` — author OR Admin
- `HintPanel` manages local state, instant UI update
- Hint: text content + optional URL + optional display label (links open in new tab)

---

## CP-5: Margin Calculator + Matching Engine ✅

- `lib/margin.ts` — `Available Margin = Balance + Σ worstCaseForContract(positions)`
  - Test points include every strike (push case captured), midpoints between adjacent strikes, ±1 boundary outside the strike range
  - `worstCaseForContract` is exported for incremental updates
  - `incrementalWorstCase(existing, candidate)` returns the delta worst-case impact of adding a candidate position
  - Pure version `calculateAvailableMarginPure` for unit testing
  - Accepts an optional `Prisma.TransactionClient` so margin reads happen under the same row lock
- `lib/pnl.ts` — binary P&L (OVER/UNDER × strike × size), push = exactly 0
- `lib/idempotency.ts` — typed `IdempotencyAction` (order, settle-contract, approve-user, deny-user, adjust-balance), UUIDv7 dedup, 24 h cleanup
- `lib/matching-engine.ts` — instant CLOB execution:
  - `snapshotMargin(tx, userId)` reads balance + open trades **once** per side, then mutates the snapshot in memory per fill
  - `maxFillByMargin(snapshot, contractId, side, strike, isAsTaker, upper)` binary-search for the largest feasible size
  - **Partial-fill semantics by default** — if a maker has limited margin, fill what they can and continue; if zero, cancel toxic quote and continue sweep
  - `Trade.idempotencyKey` persisted with unique `(idempotencyKey, quoteId)` for hard dedup
- `POST /api/orders` — LIMIT (single quote) and MARKET (FIFO sweep), instant execution
  - Idempotency-Key required (UUIDv7)
  - Price band validated on `limitPrice`
  - SELECT FOR UPDATE on quote rows inside `prisma.$transaction` (`maxWait: 5000`, `timeout: 10000`)
  - Self-trade prevention, contract mismatch guard, slippage protection on MARKET
  - Toxic-quote auto-cancel mid-sweep (returned as `cancelledQuoteIds`)
  - WebSocket emissions: `TRADE_EXECUTED` (taker + maker + contract rooms, chained `.to()`), `QUOTE_UPDATED` (contract room)

---

## CP-6: Notifications ✅

- `GET /api/notifications` — unread count + last 30 notifications (no longer surfaces pending take-requests — instant matching only)
- `PATCH /api/notifications/read` — marks all read
- `NotificationPanel` — polls every 5 s, badge with unread count, marks read on open, closes on outside click
- `Navbar` — NotificationPanel + nav links: Markets, Leaderboard, Positions, Admin (admin only)

---

## CP-7: Settlement + Leaderboard + Admin ✅

- `POST /api/contracts/[id]/settle` — Admin only, idempotency required, all-or-nothing:
  1. Cancel all OPEN quotes
  2. For each OPEN trade: compute P&L via `lib/pnl.ts`, increment balances, write SETTLEMENT BalanceLedger rows
  3. Mark contract SETTLED with `settlementValue`
  4. **Balance integrity check inside the transaction** — `user.balance` must equal `SUM(BalanceLedger.delta)` for every affected user; mismatch raises `BalanceIntegrityError` and rolls back the entire settlement
  5. Audit row (SETTLE_CONTRACT)
  6. Emit `CONTRACT_SETTLED` WebSocket event
  - On integrity failure (after rollback): notify all admins out-of-band so the issue surfaces
- `app/leaderboard/page.tsx` — ranked by `SUM(SETTLEMENT.delta)`, Admin users excluded
- `app/positions/page.tsx` — user's OPEN trades with consistent OVER (red) / UNDER (green) colour scheme via `lib/theme.ts`
- `GET /api/users/me` — balance, availableMargin, marginInUse, openTradeCount
- `GET /api/health` — DB connectivity + UTC time
- Admin pages: `app/admin/page.tsx`, `app/admin/users/page.tsx`, `app/admin/contracts/page.tsx`, `app/admin/audit-log/page.tsx`
- `DELETE /api/trades/[id]` — Admin only, OPEN trades only, both parties notified, AdminAuditLog row
- Password reset: Admin generates signed JWT (1 h via `jose`), user sets new password, audit logged
- Cron cleanup: `GET /api/cron/notifications` (90-day archive, 180-day delete) + `GET /api/cron/idempotency` (Bearer CRON_SECRET)

---

## CP-8: Tests + Hardening ✅

- `__tests__/pnl.test.ts` — 6 cases (OVER/UNDER win/loss/push)
- `__tests__/margin.test.ts` — 6 cases (no trades, single trade, hedge, multi-contract, push, maker-side flip)
- `__tests__/matching.test.ts` — 23 cases including: LIMIT fills, partial-fill semantics, toxic-quote cancellation when maker has zero margin, taker partial-fill, contract mismatch, FIFO price-time priority, slippage, UNDER side, self-trade prevention, idempotencyKey persisted on Trade rows
- `jest.config.ts` — ts-jest preset, `@/` alias mapping
- `npm run build` passes — 28 routes, 35/35 tests pass
- Race condition: SELECT FOR UPDATE on quotes inside matching transaction
- All routes: structured logging with method/path/userId/statusCode/processingTimeMs

---

## Final Checkpoint — Matching Engine + WebSockets ✅

### 1. Matching Engine ✅
Replaces the legacy take-request → confirm flow with instant execution. The TakeRequest table has been dropped at the schema level.

- `POST /api/orders` — LIMIT + MARKET, instant fill on match
- LIMIT: hit a specific quote → instant trade creation
- MARKET: sweep best-priced quotes until size filled, taker margin exhausted, slippage triggered, or book exhausted
- Price-time priority (best price first, then oldest by `createdAt`)
- Self-trade prevention, contract mismatch guard, price-band check on `limitPrice`, hard size ceiling 10 000
- **Double Margining at execution time** — taker and maker margin verified inside the `prisma.$transaction`, snapshot-based with binary-search cap so a sweep does not re-query the full margin state per iteration
- Both parties notified via `Notification` rows + WebSocket events

### 2. Market Orders (Sweep) ✅
- Taker specifies `side + size + limitPrice` → engine sweeps best available quotes
- Slippage protection: OVER stops at `limitPrice` ceiling, UNDER stops at `limitPrice` floor
- Partial fills allowed; response includes `totalFilled`, `fills[]`, `cancelledQuoteIds[]`, optional `warning` when `totalFilled === 0`
- Toxic quotes (maker margin = 0) auto-cancelled mid-sweep without aborting the order

### 3. WebSockets — Real-Time Updates ✅
- Custom `server.js` wrapping Next.js + Socket.IO on the same port
- Authentication via NextAuth session-cookie JWT decode (no spoofable userId from the client)
- Room-based targeting: `user:<id>` + `contract:<id>`
- Events: `TRADE_EXECUTED`, `QUOTE_UPDATED`, `CONTRACT_SETTLED`
- Client-side debounce (300 ms) for burst events
- Chained `.to()` so each socket receives one event even if it sits in multiple rooms
- Keepalive ping every 8 min (DigitalOcean 10-min idle timeout)
- `lib/socket-redis.ts` + lazy `require("@socket.io/redis-adapter")` in `server.js` — when `REDIS_URL` is set, every pod attaches the redis adapter so emits reach clients on any node (multi-pod scale)
- `PortfolioLive` client component — auto-refreshes on WS events

---

## Deployment ✅

- **Database**: PostgreSQL on Railway — `prisma migrate deploy` applies all migrations including `20260427200000_phase1_drop_takerequest_add_userstatus_pricebands`
- **App**: DigitalOcean App Platform — connected to GitHub main, auto-deploy on push
- **Server**: Custom `node server.js` for Next.js + Socket.IO (+ optional Redis adapter)
- **Domain**: iterlight.com with SSL auto-provisioned by DO
- **Required env vars**: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `RESET_TOKEN_SECRET`, `CRON_SECRET`
- **Optional env vars**: `REDIS_URL` (activates Redis-backed rate limiter + Socket.IO adapter for horizontal scale)

---

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| `__tests__/matching.test.ts` | 23 | ✅ Pass |
| `__tests__/margin.test.ts` | 6 | ✅ Pass |
| `__tests__/pnl.test.ts` | 6 | ✅ Pass |
| End-to-end smoke test (`scripts/local-only/smoke-test.js`) | 26 | ✅ Pass |
| **Total** | **61** | **All Pass** |

---

## Local-Only Scripts

`scripts/local-only/` — guarded by `NODE_ENV !== 'production'` + DATABASE_URL hostname check:
- `smoke-test.js` — full HTTP end-to-end coverage (CSRF, register-PENDING, admin-approve, login, post quote, LIMIT order, idempotency replay, MARKET sweep, settlement, balance integrity, audit log, RBAC)
- `reset_passwords.js` — bulk reset for E2E testing
- `check-users.js`, `check_alice.js` — ad-hoc inspection

---

## Phase 2 — Planned

Market-maker bot ecosystem (separate plan).
