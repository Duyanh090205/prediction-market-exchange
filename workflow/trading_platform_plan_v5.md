# Prediction Market Trading Platform — Plan v5

---

## Table of Contents

1. [What the Platform Is](#1-what-the-platform-is)
2. [Technology Stack](#2-technology-stack)
3. [User Roles](#3-user-roles)
4. [Trading Model — Precise Definition](#4-trading-model--precise-definition)
5. [Business Rules](#5-business-rules)
6. [Margin System](#6-margin-system)
7. [Balance Ledger](#7-balance-ledger)
8. [Security & Authentication](#8-security--authentication)
9. [Idempotency](#9-idempotency)
10. [Implementation Map](#10-implementation-map)
11. [Production Hardening](#11-production-hardening)
12. [Deployment](#12-deployment)
13. [Design Decisions Summary](#13-design-decisions-summary)

---

## 1. What the Platform Is

A web application for running prediction-market games on numerical outcomes — for example, "How many minutes did Player X play in the tournament?" A liquidity provider acts as the primary market maker; everyone else trades against the LP's prices or against each other. The platform is built to scale beyond a closed group: registration is public but admin-gated, the matching layer is an instant CLOB, and the rate limiter / WebSocket layer can switch to Redis for multi-pod deployments.

**The core loop:**
1. Admin creates a contract — a question with a numerical answer and a price band (e.g. 0–100)
2. The LP (and optionally other players) post Bid/Ask/Size quotes inside the price band
3. Any user submits a LIMIT order against a specific quote, or a MARKET order that sweeps the book
4. Orders execute instantly under SELECT FOR UPDATE with double-margining; partial fills are normal
5. Admin settles the contract by entering the real answer — coins change hands and the BalanceLedger is updated atomically with an integrity check

---

## 2. Technology Stack

| Layer | Technology | Role |
|---|---|---|
| Database | PostgreSQL (Railway) | Permanent storage for all data |
| ORM | Prisma 6 | Translates code into database queries |
| Backend | Next.js 15 App Router — Route Handlers in `app/api/` | Rules engine, all business logic lives here |
| Auth | NextAuth.js v5 | Session with status gate (PENDING/ACTIVE/SUSPENDED), 30 s DB-cache |
| Real-time | Socket.IO via custom `server.js` | Push order-book / portfolio updates |
| Cache / scale | Optional Redis (`REDIS_URL`) | Pluggable rate-limiter store + Socket.IO multi-pod adapter |
| Frontend | Next.js App Router — Server & Client Components + Tailwind | Everything the user sees |
| Hosting | Digital Ocean App Platform (app) + Railway (database) | Live on the internet |
| Domain | <your-domain> | Custom domain pointing to App Platform |

**Router consistency rule:** The entire project uses App Router only. Pages live in `app/`, API endpoints live in `app/api/`. No `pages/` folder exists anywhere. Mixing the two routers will cause unpredictable behavior and must be avoided from day one.

---

## 3. User Roles & Status

| Role | Default Starting Balance | Permissions |
|---|---|---|
| ADMIN | configured per account | Create contracts, settle, approve/deny/suspend/reactivate users, adjust balances, generate password reset tokens. Cannot post quotes, cannot trade. |
| LIQUIDITY_PROVIDER | configured per account | Quotes displayed prominently on every market page. Can post, edit, delete hints. Can trade like any USER. Required to post two-sided quotes. |
| USER | configured per account | Post quotes (one-sided allowed), submit LIMIT or MARKET orders. |

**Status lifecycle (`UserStatus` enum):**
```
PENDING ──admin approve──▶ ACTIVE ──admin suspend──▶ SUSPENDED
                                  ◀──admin reactivate──
PENDING ──admin deny──▶ (deleted)
```

PENDING and SUSPENDED users cannot establish a session — the credentials provider blocks them with a clear error.

**Role rules:**
- Roles are set at account creation (admin) or default to USER (public registration)
- Public `/api/auth/register` creates accounts as PENDING with balance 0; an admin must approve to grant the starting balance and write the INITIAL_SEED ledger entry
- Admin is strictly a manager — backend rejects any attempt to post a quote or submit an order
- LIQUIDITY_PROVIDER role is what makes a maker's quote appear prominently — not a manual flag

---

## 4. Trading Model — Precise Definition

This is **binary spread betting**. Every part of the system — margin calculation, P&L logic, settlement — must be consistent with this definition.

### Core Concepts

**Quote** is an offer posted by a maker, consisting of:
- **Bid** — the lower threshold. If a taker chooses UNDER, the strike is set at this number
- **Ask** — the upper threshold. If a taker chooses OVER, the strike is set at this number
- **Size** — maximum coins the maker is willing to trade on this quote. Integer only, minimum 1

**Strike** is determined at the moment a take request is submitted, based on which side the taker selects:
- Taker chooses **OVER** → strike = Ask
- Taker chooses **UNDER** → strike = Bid

The strike is recorded on the Trade record when the request is confirmed. It does not change after that.

**Payout** is binary and fixed at ±size. There is no proportional payout based on distance from the result.

| Taker Side | Settlement Result X | Taker P&L | Maker P&L |
|---|---|---|---|
| OVER | X > strike | +size | −size |
| OVER | X < strike | −size | +size |
| OVER | X = strike | 0 | 0 (push) |
| UNDER | X < strike | +size | −size |
| UNDER | X > strike | −size | +size |
| UNDER | X = strike | 0 | 0 (push) |

No rake. No house edge. Every trade is strictly zero-sum between the two parties.

### Worked Example

The LP posts quote **220 / 240 × 25** on a contract with price band 0–500. Ivan submits a LIMIT OVER order → strike is recorded as 240, size is 25.

- The matching engine instantly creates a Trade: taker = Ivan, maker = LP, taker\_side = OVER, strike = 240, size = 25; quote inventory drops to 0 (EXHAUSTED). No accept/reject step.
- Admin settles the contract with X = 255
- 255 > 240 → Ivan wins +25 coins, LP loses −25 coins
- If X = 200: Ivan loses −25, LP wins +25
- If X = 240: push, both get 0

---

## 5. Business Rules

These rules are enforced at the backend. The UI may show helpful messages, but the backend is the authoritative enforcer.

### Contract Rules

- A contract has a `minPrice` and `maxPrice` that define its price band. All bids, asks, market `limitPrice` values, and the final `settlementValue` must lie inside `[minPrice, maxPrice]`. Defaults are 0 and 100
- `minPrice < maxPrice` is mandatory at creation
- Admin may delete an OPEN contract only if no trades exist on it. Otherwise, settle it instead

### Quote Rules

- `bid < ask` is mandatory. If violated, the API returns a validation error and nothing is written to the database
- Size minimum is 1 coin. No decimals. No tick size for MVP
- LP must post both bid and ask. USER may post a one-sided quote (bid-only or ask-only)
- bid and ask must lie inside the contract's price band
- The maker must have available margin ≥ size at post time. A quote that exceeds the maker's margin is rejected outright (no toxic posting)
- PATCH may grow size only if the maker has additional margin headroom equal to the size delta
- Admin may cancel any quote; doing so notifies the maker and writes a CANCEL_QUOTE audit row

### Order Rules (Instant Matching — no take-request flow)

- A user cannot trade against their own quote (self-trade prevention)
- LIMIT orders specify a `quoteId`; MARKET orders specify a `limitPrice` for slippage protection
- `limitPrice` must lie inside the contract's price band
- Hard ceiling: requested size ≤ 10 000
- Every order body must include an `Idempotency-Key` (UUIDv7); replays return the cached response
- Both the taker's and the maker's available margin are re-validated **inside** the SELECT FOR UPDATE transaction
- Partial fills are normal: the engine fills `min(quote inventory, taker margin cap, maker margin cap)` per quote and continues sweeping
- Toxic quotes (maker margin = 0) are auto-cancelled mid-sweep; the order continues against the next best quote
- The strike recorded on the Trade: Ask if `side = OVER`, Bid if `side = UNDER`. The Trade row also persists the order's idempotencyKey, with a unique `(idempotencyKey, quoteId)` constraint as a hard dedup safety net
- WebSocket emissions: `TRADE_EXECUTED` (taker + maker + contract rooms), `QUOTE_UPDATED` (contract room) on every fill; `CONTRACT_SETTLED` on settlement

### Contract & Entity States

**Contract:**
```
OPEN → SETTLED
```
No pausing, no re-opening. Once SETTLED it is permanent.

**Quote:**
```
OPEN → EXHAUSTED  (size depleted to 0 by fills)
     → CANCELLED  (maker or admin cancels, or contract settles, or maker margin = 0 mid-sweep)
```

**Trade:**
```
OPEN → SETTLED
```

**User:**
```
PENDING → ACTIVE → SUSPENDED → ACTIVE
```

### Admin Account Management Flow

Public registration creates accounts in `PENDING` status with balance 0 — no balance is granted and no INITIAL_SEED ledger row is written until an admin acts. The admin reviews the pending queue and uses `PATCH /api/admin/users/[id]` with one of these actions:

- `approve` — sets status to ACTIVE, applies the chosen starting balance, writes the INITIAL_SEED BalanceLedger row, sends a notification, and writes an APPROVE_USER audit row
- `deny` — hard-deletes the PENDING registration; only allowed before approval
- `suspend` / `reactivate` — toggle ACTIVE ↔ SUSPENDED for an existing user
- `adjust_balance` — admin manually adjusts a user's balance with a mandatory reason (≥ 5 chars). Writes an ADMIN_ADJUSTMENT BalanceLedger entry, notifies the user, and writes an audit row

All actions run atomically with their AdminAuditLog entry. Every audit row captures `adminId`, `action`, `targetType`, `targetId`, `metadata`, `ipAddress`, and a human-readable note.

### Admin Password Reset Flow

When a user forgets their password:
1. Admin goes to the admin panel and generates a reset token for that user
2. The token is a signed JWT (`jose`) valid for 1 hour (UTC)
3. Admin copies the reset link and sends it to the user manually (Discord, etc.)
4. The user opens the link, enters a new password, submits
5. The system validates the token (not expired, not already used), hashes the new password, saves it, marks the token used
6. Admin never sees the new password. PASSWORD_RESET is recorded in AdminAuditLog

This flow avoids admin knowing any user's password without requiring an email server.

### Notification Retention

Notifications accumulate over time and must be managed:
- Notifications older than 90 days are moved to a `NotificationArchive` table by a daily cron job
- Notifications older than 180 days are permanently deleted from the archive
- The cron job runs at midnight UTC daily

---

## 6. Margin System

### The Formula

```
Available Margin = Balance + Worst-Case P&L
```

`Worst-Case P&L` is always ≤ 0. The formula is always written this way — never as `balance − worst_case_loss` — to avoid sign confusion.

**Example:** Balance = 1,000. Worst-Case P&L across all open trades = −400. Available Margin = 1,000 + (−400) = **600**.

### What Counts Toward Margin

Only OPEN confirmed trades contribute to margin lockup. There is no longer a take-request layer that locks margin for unconfirmed intent — orders execute instantly, so a position is either OPEN (locking margin) or it does not exist.

### How Worst-Case P&L Is Calculated

The calculation groups open trades by contract, then simulates outcomes:

1. Collect all OPEN confirmed trades where the user is taker or maker
2. Group by contract
3. For each contract, gather all strike prices. Create test points: every strike (captures the push case), the midpoint between each adjacent pair, and one tick below the lowest / above the highest
4. At each test point, sum the user's P&L across all positions on that contract (taker → +/− size; maker → opposite sign)
5. The worst case for that contract = the minimum value across all test points
6. Sum worst cases across all contracts → total Worst-Case P&L

Different contracts are summed independently (their outcomes are not correlated).

`worstCaseForContract` and `incrementalWorstCase(existing, candidate)` are exported from `lib/margin.ts` so the matching engine can update a snapshot in memory per fill instead of re-querying the full margin state.

### Worked Margin Example

Ivan has two open trades on Contract A:
- Trade 1: OVER at strike 220, size 50 (Ivan is taker)
- Trade 2: UNDER at strike 240, size 30 (Ivan is taker)

Test points for Contract A: 219, 230 (midpoint), 241

| Test Point | Trade 1 P&L | Trade 2 P&L | Total |
|---|---|---|---|
| 219 (below 220) | −50 | +30 | **−20** |
| 230 (between) | +50 | +30 | +80 |
| 241 (above 240) | +50 | −30 | +20 |

Worst-case for Contract A = −20. If Ivan's balance is 1,000 → Available Margin = 1,000 + (−20) = **980**.

### Margin Is Checked Twice (Double Margining)

- **Submission gate (cheap fail-fast):** before opening the transaction, `/api/orders` reads the taker's available margin and rejects with HTTP 422 if the user has zero margin headroom
- **Execution check (authoritative):** inside the `prisma.$transaction` with SELECT FOR UPDATE on the affected quote(s), the matching engine snapshots both the taker's and each maker's balance + open trades **once**, then computes the maximum feasible fill via `maxFillByMargin` (binary search) and mutates the snapshot in memory per fill. If the cap collapses to 0, the engine throws `TakerMarginError` (taker exhausted) or `MakerMarginError` after cancelling the toxic quote (maker can't honour any size).

---

## 7. Balance Ledger

Every change to a user's balance must produce a corresponding row in the `BalanceLedger` table. No balance update ever happens without a ledger entry.

### What Each Row Records

- **user\_id** — whose balance changed
- **delta** — the change amount (positive = credit, negative = debit)
- **balance\_after** — the user's balance after this change was applied
- **event\_type** — one of: `INITIAL_SEED`, `SETTLEMENT`, `ADMIN_ADJUSTMENT`
- **trade\_id** — the trade involved (nullable, used for SETTLEMENT entries)
- **contract\_id** — the contract involved (nullable)
- **initiated\_by** — the user ID who triggered the change (admin for settlements/adjustments, NULL for system-initiated entries such as INITIAL_SEED on public registration approval)
- **note** — short human-readable description, e.g. "Settlement contract #5, trade #12 — Ivan OVER 240 × 25, result 255"
- **created\_at** — UTC timestamp

Indexed by `(userId, createdAt)` for efficient leaderboard / audit queries.

### Integrity Verification

The settlement transaction itself includes the integrity check. For each user whose balance is updated, the system reads `SUM(BalanceLedger.delta)` (within the same `tx`) and compares to the user's current balance. If any user mismatches:

- The transaction throws `BalanceIntegrityError` and **rolls back the entire settlement** (no partial state is persisted)
- After the rollback, an out-of-band notification is sent to every ADMIN with the offending users' balance vs ledger sum
- A human (Admin) must investigate before any further settlements proceed

Aborting on mismatch (rather than logging and continuing) prevents silent balance corruption from compounding across settlements.

---

## 8. Security & Authentication

### Login & Session

- **Password policy:** Minimum 8 characters. No complexity requirements beyond minimum length
- **Password storage:** bcrypt hashed with a work factor of 12. Plaintext passwords are never stored, logged, or transmitted
- **Session duration:** 7 days. JWT strategy with a 30-second DB-cache: the session callback only re-fetches the user once per 30 s window per token. Status changes (PENDING → ACTIVE → SUSPENDED) and role changes propagate within 30 s; deletion does too
- **Status gate:** the credentials provider rejects PENDING and SUSPENDED users with a clear error before issuing a session

### Rate Limiting

`lib/rate-limiter.ts` exposes a pluggable backend:
- **Default**: in-memory store, fine for single-pod deployments
- **Production scale**: when `REDIS_URL` is set, lazy-imports `ioredis` and switches to a Redis-backed store so multi-pod deployments share state

Scopes:
- `login:<ip>` — 10 failures / 15 min
- `register:<ip>` — 5 attempts / 1 hour

A successful login resets the login counter for that IP. Failed login also logs the attempted email (structured WARN line) so admins can correlate IP-share collisions in shared offices / households.

### CSRF Protection

`lib/csrf.ts` is strict by default:
- Refuses every state-changing request if `NEXTAUTH_URL` is unset (server misconfiguration → fail closed)
- Requires `Origin` OR `Referer` (whichever is present) to match `NEXTAUTH_URL`
- POST/PUT/PATCH must declare `Content-Type: application/json`
- DELETE relies on origin/referer alone (no body to type-check)

NextAuth handles CSRF for its own auth endpoints automatically.

### HTTP Security Headers

Added to `next.config.ts`:

| Header | Value | Purpose |
|---|---|---|
| `X-Frame-Options` | `DENY` | Prevents iframe embedding (clickjacking) |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits Referer leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | Disables unused browser features and FLoC |
| `Content-Security-Policy` | strict in prod (`default-src 'self'`, no `'unsafe-eval'`); relaxed in dev for Turbopack/HMR | Restricts resource loading |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (prod only) | Forces HTTPS |

### Role & Status Enforcement at the API Layer

Every Route Handler that performs a privileged action checks the session role before doing anything else:

- Settle, delete-contract, delete-trade, delete-quote (someone else's), audit log, user lifecycle: `role === ADMIN`
- Create-contract: `ADMIN || LIQUIDITY_PROVIDER`
- Post/edit/delete hints: `LIQUIDITY_PROVIDER || ADMIN`
- Post quote, submit order: `role !== ADMIN`
- All authenticated routes implicitly require `status === ACTIVE` (enforced by the session callback)

A mismatch returns HTTP 403 before any database query runs.

### Admin Audit Log

`lib/audit.ts` exports `logAdminAction(entry, tx?)` so every destructive admin operation writes its AdminAuditLog row inside the same transaction as the action it records. Captured fields: `adminId`, `action`, `targetType`, `targetId`, `targetUserId`, `metadata` (JSONB), `ipAddress`, `note`, `createdAt`. Indexed by `action`, `(targetType, targetId)`, and `createdAt` for filterable forensic queries via `GET /api/admin/audit-log`.

---

## 9. Idempotency

### Why It Matters

Network delays and accidental double-clicks can cause the same action to be submitted twice. Without idempotency protection, a user could accidentally create two take requests on the same quote, or confirm the same request twice.

### How It Works

**Client side:**
1. Before submitting a form for any state-changing action (submit take request, confirm, reject), the client generates a UUIDv7 value
2. This value is sent as an HTTP header: `Idempotency-Key: <UUIDv7>`
3. The submit button is disabled immediately after the first click and its label changes to "Processing…". If the request fails with a server error, the button re-enables so the user can retry with a new key

**Server side:**
1. Validate the `Idempotency-Key` header is present. If missing, reject with HTTP 400
2. Validate the value matches UUIDv7 format using a regex. If invalid format, reject with HTTP 422
3. Look up the key in the `IdempotencyKey` table using the composite `(actor_id, action, idempotency_key)` index
4. If a record exists with the same key and a matching `request_hash` (hash of the request body) → return the stored response immediately without processing again
5. If a record exists with the same key but a different `request_hash` → reject with HTTP 422 "Same key, different payload"
6. If no record exists → process the request normally, then store `(actor_id, action, key, request_hash, response)` in the table
7. Keys are automatically deleted after 24 hours via a scheduled cleanup

**Actions that require idempotency keys (typed `IdempotencyAction`):**
- `order` — `POST /api/orders` (LIMIT or MARKET execution)
- `settle-contract` — `POST /api/contracts/:id/settle`
- `approve-user`, `deny-user`, `adjust-balance` — admin lifecycle ops where double-firing would write duplicate ledger entries

The Trade row also stores the order's `idempotencyKey` directly, with a unique `(idempotencyKey, quoteId)` constraint as a hard dedup safety net independent of the IdempotencyKey table.

**Actions that do not require idempotency keys:**
- Read endpoints (GET)
- Post/edit/cancel quote (low stakes, easily reversible)
- Approve/suspend lifecycle ops outside the listed set

---

## 10. Implementation Map

The platform is implemented; the original day-by-day breakdown has been collapsed into the layout below. See `workflow/phase-1.md` for per-checkpoint details and `workflow/project-walkthrough.md` for the architecture walkthrough.

### Database Schema (`prisma/schema.prisma`)

11 tables. `TakeRequest` has been removed in migration `20260427200000_phase1_drop_takerequest_add_userstatus_pricebands`.

- `User` — username, email, hashedPassword, balance, role, **status (PENDING/ACTIVE/SUSPENDED)**, approvedAt, approvedBy
- `Contract` — title, description, status, **minPrice**, **maxPrice**, settlementValue
- `Quote` — contractId, makerId, bid, ask, size, status (bid/ask nullable for one-sided USER quotes)
- `Trade` — contractId, quoteId, takerId, makerId, takerSide, strike, size, status, takerPnl, makerPnl, **idempotencyKey** (unique with quoteId)
- `Hint` — contractId, authorId, content, linkUrl, linkLabel
- `Notification` / `NotificationArchive` — `originalId` unique on the archive
- `BalanceLedger` — userId, delta, balanceAfter, eventType (`INITIAL_SEED` / `SETTLEMENT` / `ADMIN_ADJUSTMENT`), tradeId, contractId, **initiatedBy nullable**, note. Indexed by `(userId, createdAt)`
- `IdempotencyKey` — unique `(actorId, action, idempotencyKey)`, 24 h cleanup
- `PasswordResetToken` — hashed token, 1 h expiry, signed JWT delivered out of band
- `AdminAuditLog` — adminId, action, **targetType / targetId / metadata (JSONB) / ipAddress**, note. Indexed on action, (targetType, targetId), createdAt

### API Surface (`app/api/`)

| Path | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/register` | POST | Public (rate-limited 5/h/IP) | Create PENDING account, balance 0 |
| `/api/auth/reset-password` | POST | Public (token) | Set new password from admin-issued JWT |
| `/api/orders` | POST | USER/LP | LIMIT or MARKET order — instant matching |
| `/api/contracts` | GET | All | List OPEN contracts |
| `/api/contracts` | POST | Admin or LP | Create contract with price band |
| `/api/contracts/[id]` | GET | All | Detail: quotes, hints, OPEN trades |
| `/api/contracts/[id]` | DELETE | Admin | Delete OPEN contract w/ no trades; audited |
| `/api/contracts/[id]/settle` | POST | Admin | Idempotent settlement w/ in-tx integrity check |
| `/api/quotes` | POST | USER/LP | Margin + price-band check; 422 if maker margin < size |
| `/api/quotes/[id]` | PATCH | Maker | Re-validates band; checks delta margin if size grows |
| `/api/quotes/[id]` | DELETE | Maker / Admin | Cancel; admin path audited |
| `/api/hints` | POST | LP/Admin | Post hint |
| `/api/hints/[id]` | PATCH/DELETE | Author / Admin | Edit / delete |
| `/api/notifications` | GET | All | Unread count + last 30 |
| `/api/notifications/read` | PATCH | All | Mark all read |
| `/api/users/me` | GET | All | Balance + margin info |
| `/api/health` | GET | Public | DB connectivity + UTC time |
| `/api/trades/[id]` | DELETE | Admin | Delete OPEN trade; audited |
| `/api/admin/users` | GET / POST | Admin | List / create (skips approval) |
| `/api/admin/users/[id]` | PATCH | Admin | approve / deny / suspend / reactivate / adjust_balance |
| `/api/admin/password-reset` | POST | Admin | Generate 1 h reset link |
| `/api/admin/audit-log` | GET | Admin | Filterable audit history |
| `/api/cron/notifications` | GET | Bearer | Archive 90 d, delete 180 d |
| `/api/cron/idempotency` | GET | Bearer | Cleanup keys > 24 h |

### Pages (`app/`)

`/`, `/login`, `/register`, `/reset-password`, `/markets/[id]`, `/markets/create`, `/leaderboard`, `/positions`, `/admin`, `/admin/users`, `/admin/contracts`, `/admin/audit-log`.

### Lib Modules (`lib/`)

- `matching-engine.ts` — `executeLimitOrder`, `executeMarketOrder`, snapshot-based double margining, partial-fill semantics, toxic-quote auto-cancel
- `margin.ts` — `calculateAvailableMargin`, `worstCaseForContract`, `incrementalWorstCase`, `calculateAvailableMarginPure`
- `pnl.ts` — binary P&L
- `audit.ts` — `logAdminAction`, `extractClientIp`
- `idempotency.ts` — typed `IdempotencyAction`, UUIDv7 dedup
- `csrf.ts` — strict origin validation
- `rate-limiter.ts` — pluggable in-memory | Redis store
- `socket-events.ts` — server-side WS emitters (chained `.to()`)
- `socket-redis.ts` — optional `@socket.io/redis-adapter` attach
- `socket-client.ts` — singleton with auto-reconnect
- `theme.ts` — OVER (red) / UNDER (green) single source of truth
- `logger.ts` — structured logger + `sanitizeBodyForLog`
- `prisma.ts` — Prisma singleton

### Tests

- `__tests__/matching.test.ts` — 23 cases (LIMIT, partial fills, FIFO, slippage, MARKET sweep, self-trade prevention, contract mismatch, toxic quote handling)
- `__tests__/margin.test.ts` — 6 cases (push, hedge, multi-contract, maker-side flip)
- `__tests__/pnl.test.ts` — 6 cases (binary table coverage)
- `scripts/local-only/smoke-test.js` — 26-step end-to-end HTTP smoke (CSRF, register-PENDING, admin approve/suspend/adjust, login, post quote, LIMIT, idempotency replay, MARKET sweep, settlement, balance integrity, audit log, RBAC)

`npm test` + `npm run build` are CI gates.

---

## 11. Production Hardening

### Race-Condition Prevention

The matching engine wraps every order in a `prisma.$transaction` with `SELECT FOR UPDATE` on the affected quote rows. Concurrent orders against the same quote serialize on the row lock; the second one reads the post-fill state and re-evaluates caps.

### Snapshot-Based Double Margining

`snapshotMargin(tx, userId)` reads balance + open trades **once** per user per transaction. `maxFillByMargin` (binary search on `incrementalWorstCase`) computes the largest feasible fill given the snapshot; the snapshot is mutated in memory after each fill so subsequent caps reflect the new position. Compared to re-querying the full margin state per loop iteration, this keeps the transaction window short even for deep sweeps.

### Settlement Integrity (in-transaction)

The settlement transaction reads `user.balance` and `SUM(BalanceLedger.delta)` via the same `tx` for every affected user and aborts on any mismatch. Admins are notified out-of-band post-rollback so the issue surfaces.

### Idempotency

UUIDv7 via the `Idempotency-Key` header for every mutating order / settle / lifecycle endpoint. Replays return the cached response. The Trade table also enforces `(idempotencyKey, quoteId)` uniqueness as a hard fallback in case the IdempotencyKey row is ever lost or pruned during retry.

### Logging

Every Route Handler logs `method`, `path`, `userId`, `statusCode`, `processingTimeMs` as a structured JSON line. High-stakes actions also log `tradeId` / `contractId` / `outcome`. Errors include the full stack and route metadata. `sanitizeBodyForLog` drops sensitive fields (passwords, tokens) and truncates long strings before they hit logs.

### Health Check

`GET /api/health` returns DB connectivity + UTC time. DigitalOcean App Platform pings it for outage detection.

### Horizontal Scale

- `lib/rate-limiter.ts` swaps to a Redis backend transparently when `REDIS_URL` is set
- `server.js` lazy-loads `@socket.io/redis-adapter` so emits reach sockets on any pod
- The 30 s session DB-cache cuts session lookups by 95 % at scale

---

## 12. Deployment

### Required environment variables
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | JWT signing secret |
| `NEXTAUTH_URL` | App URL (also used by CSRF guard) |
| `RESET_TOKEN_SECRET` | Password reset JWT secret |
| `CRON_SECRET` | Bearer token for cron endpoints |

### Optional environment variables
| Variable | Effect |
|---|---|
| `REDIS_URL` | Activates Redis-backed rate limiter + Socket.IO redis adapter |

If `REDIS_URL` is set, install `ioredis` and `@socket.io/redis-adapter` in production deps.

### Steps
1. Provision PostgreSQL (Railway). Run `prisma migrate deploy` — applies all migrations including `20260427200000_phase1_drop_takerequest_add_userstatus_pricebands`
2. (Optional) Provision Redis and set `REDIS_URL`
3. Deploy `server.js` on DigitalOcean App Platform with the env vars above. Build command: `npm run build`. Run command: `node server.js`
4. Point `<your-domain>` to App Platform, wait for SSL provisioning
5. Seed at least one ADMIN account; everyone else can self-register through `/register` and is approved by admin

### Post-deploy checks
- `https://<your-domain>/api/health` returns `{ status: "ok" }`
- Sign up via `/register`, confirm account is PENDING, admin approves, login succeeds
- A LIMIT order against an LP quote settles the trade row with the order's idempotencyKey persisted

---

## 13. Design Decisions Summary

| Topic | Decision |
|---|---|
| Trading model | Binary spread betting — OVER or UNDER a strike, fixed ±size payout |
| Strike | Taker side determines: OVER → strike = ask, UNDER → strike = bid |
| Bid/Ask | Thresholds, not probabilities; `bid < ask` enforced at backend |
| Price band | Per-contract `minPrice/maxPrice` (default 0–100) enforced on quotes, market `limitPrice`, and `settlementValue` |
| Size | Integer coins, ≥ 1, hard ceiling 10 000 |
| Payout | Binary, not proportional |
| Matching | Instant CLOB — LIMIT (specific quote) or MARKET (FIFO sweep with slippage protection); take-request flow removed |
| Margin formula | `available = balance + Σ worstCaseForContract(positions)` (≤ 0) |
| Margin scope | Only OPEN confirmed trades — no pending intent layer |
| Maker margin gate | Quotes that exceed the maker's available margin are rejected at post time |
| Toxic quote | Maker margin = 0 mid-sweep → quote auto-cancelled, sweep continues |
| Partial fills | Default behaviour; response includes fills + cancelledQuoteIds + optional `warning` for zero-fill |
| Admin trading | Blocked at API layer |
| Account lifecycle | Public register → PENDING → admin approve → ACTIVE; suspend/reactivate available; admin path skips PENDING and audits everything |
| BalanceLedger | Every balance change writes a row. Integrity verified inside the settlement transaction; abort + admin alert on mismatch |
| Idempotency | UUIDv7 header for mutating endpoints; persisted on Trade rows for hard dedup |
| WebSocket | NextAuth JWT-cookie auth, room targeting, optional Redis adapter for multi-pod |
| Session | JWT strategy + 30 s DB-cache; PENDING/SUSPENDED users blocked at credentials provider |
| CSRF | Strict Origin/Referer match against `NEXTAUTH_URL`; refuses if `NEXTAUTH_URL` unset |
| Rate limiter | Pluggable in-memory | Redis backend; login + register scopes |
| Hosting | DigitalOcean App Platform + Railway PostgreSQL (+ optional Redis) |
| Domain | <your-domain>, SSL auto-provisioned |
| Router | App Router only |
| Timezones | UTC everywhere |
| Password reset | Admin-issued JWT, 1 h expiry, audit logged; admin never sees new password |
| Notification retention | Archive at 90 d, delete at 180 d via daily cron |
| Forensics | Every destructive admin action goes through `lib/audit.ts → logAdminAction(...)` atomically with the action |
