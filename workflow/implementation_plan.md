# Prediction Market Trading Platform — Implementation Plan

**Source**: [trading_platform_plan_v5.md](file:///d:/Quant%20Trading%20Platform/trading_platform_plan_v5.md)
**Last synced with plan v5**: 2026-04-15

---

## 1. What We're Building

A private web app for a group of friends to run a prediction market game. Binary spread betting on numerical questions — OVER/UNDER a strike, fixed ±size payout. Sam is the primary market maker, everyone else trades against Sam's prices (or each other) to win coins.

**Core loop**: Admin creates contract → Sam posts quotes → Players take quotes → Maker confirms → Admin settles → Coins change hands

---

## 2. Technology Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Database | PostgreSQL (Railway) | Permanent storage for all data |
| ORM | Prisma | Translates code into database queries |
| Backend | Next.js App Router — Route Handlers in `app/api/` | Rules engine, all business logic |
| Auth | NextAuth.js v5 | Session management, identity on every request |
| Frontend | Next.js App Router — Server & Client Components + Tailwind | Everything the user sees |
| Hosting | **Digital Ocean App Platform** (app) + Railway (database) | Live on the internet |
| Domain | **iterlight.com** (DNS pointed to App Platform, SSL auto-provisioned) | Custom domain |

**Router rule**: App Router only. No `pages/` folder. Ever.

---

## 3. User Roles

| Role | Starting Balance | Permissions |
|------|-----------------|-------------|
| ADMIN | 1,000 coins | Create contracts, settle contracts, create user accounts, generate password reset tokens. **Cannot post quotes, cannot trade.** |
| LIQUIDITY_PROVIDER (Sam) | 10,000 coins | Quotes displayed prominently. Can post/edit/delete hints. Can trade like any USER. |
| USER | 1,000 coins | Post quotes, submit take requests, confirm/reject requests on own quotes. |

- Roles fixed at account creation — no self-change
- Only Admin creates accounts (scalable, no user limit)
- Admin blocked from trading at the API layer (HTTP 403)
- Sam detected by `role === LIQUIDITY_PROVIDER`, not manual flag

---

## 4. Trading Model — Binary Spread Betting

| Taker Side | Settlement Result X | Taker P&L | Maker P&L |
|------------|-------------------|-----------|-----------|
| OVER | X > strike | +size | −size |
| OVER | X < strike | −size | +size |
| OVER | X = strike | 0 | 0 (push) |
| UNDER | X < strike | +size | −size |
| UNDER | X > strike | −size | +size |
| UNDER | X = strike | 0 | 0 (push) |

- Strike: OVER → ask, UNDER → bid
- Payout: binary ±size, not proportional
- Zero-sum, no rake, no house edge

---

## 5. Review Workflow — 8 Checkpoints

| # | Checkpoint | What You Verify | Plan v5 Section |
|---|-----------|----------------|-----------------|
| CP-1 | Project scaffold + Schema + Auth | `npm run dev` starts, Prisma schema compiles, login page renders | Day 1 Steps 1–3 |
| CP-2 | Seed + Day 1 Gate | All users log in, roles/balances correct, rate limiting works, 7 INITIAL_SEED ledger rows | Day 1 Step 4 |
| CP-3 | Contract & Quote APIs + Market UI | CRUD works, two-column layout, Sam's quote prominent on left | Day 2 Steps 1–3 |
| CP-4 | Hints + Day 2 Gate | Hints CRUD, links open new tab, `bid >= ask` rejected | Day 2 Step 4 |
| CP-5 | Margin Calculator + Trading APIs | 5 margin tests pass, take/confirm/reject/cancel flow end-to-end | Day 3 Steps 1–4 |
| CP-6 | Notifications + Day 3 Gate | NotificationPanel polls, inline confirm/reject, margin enforced at both points | Day 3 Step 5 |
| CP-7 | Settlement + Leaderboard + Positions | Full game loop, push case correct, leaderboard by settled P&L, integrity check | Day 4 all |
| CP-8 | Tests + Production Hardening | Unit tests 100%, 12 edge cases verified, health endpoint, logging, build succeeds | Day 5 Steps 1–2 |

After CP-8, deployment to **Digital Ocean App Platform + iterlight.com** is a separate step we do together.

---

## 6. Day 1 — Foundation

**Goal**: Working database, login system, and initial user accounts. Nothing visible in the UI yet, but nothing else can be built without this.

### Step 1 — Initialize Next.js Project

- `npx create-next-app@latest ./` — App Router, TypeScript, **Tailwind CSS**, ESLint
- `app/` and `app/api/` folders — no `pages/`
- Dependencies: `prisma`, `@prisma/client`, `next-auth@5` (beta for App Router), `bcryptjs`, `uuid`
- `.env.local`:
  ```
  DATABASE_URL=postgresql://postgres:localpassword@localhost:5432/trading_game
  NEXTAUTH_SECRET=<generated>
  NEXTAUTH_URL=http://localhost:3000
  RESET_TOKEN_SECRET=<generated>
  ```

### Step 2 — Security Headers (`next.config.ts`)

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control Referer header |
| `Content-Security-Policy` | `default-src 'self'` | Restrict resource loading |

### Step 3 — Database Schema (`prisma/schema.prisma`)

All 12 tables defined at once, then `prisma migrate dev`:

| Table | Key Fields |
|-------|-----------|
| `User` | id, username, email, hashedPassword, balance (Int), role (enum: ADMIN / LIQUIDITY_PROVIDER / USER), createdAt, updatedAt |
| `Contract` | id, title, description, status (enum: OPEN / SETTLED), settlementValue (Int?, nullable), createdAt, updatedAt |
| `Quote` | id → Contract, → User (maker), bid (Int), ask (Int), size (Int), status (enum: OPEN / EXHAUSTED / CANCELLED), createdAt, updatedAt |
| `TakeRequest` | id → Quote, → User (requester), side (enum: OVER / UNDER), size (Int), status (enum: PENDING / CONFIRMED / REJECTED / CANCELLED / EXPIRED), expiresAt (DateTime UTC), createdAt |
| `Trade` | id → Contract, → Quote, → User (taker), → User (maker), takerSide (enum), strike (Int), size (Int), status (enum: OPEN / SETTLED), takerPnl (Int?), makerPnl (Int?), createdAt |
| `Hint` | id → Contract, → User (author), content (Text), linkUrl (String?), linkLabel (String?), createdAt, updatedAt |
| `Notification` | id → User, message (Text), isRead (Boolean default false), createdAt |
| `NotificationArchive` | id, originalId, → User, message, isRead, originalCreatedAt, archivedAt |
| `BalanceLedger` | id → User, delta (Int), balanceAfter (Int), eventType (enum: INITIAL_SEED / TRADE_CONFIRM / SETTLEMENT), tradeId (Int?), contractId (Int?), initiatedBy (Int), note (Text), createdAt (DateTime UTC) |
| `IdempotencyKey` | id, actorId, action (Text), idempotencyKey (Text), requestHash (Text), response (Text), createdAt. **Unique on (actorId, action, idempotencyKey)** |
| `PasswordResetToken` | id → User, tokenHash (Text), expiresAt (DateTime), usedAt (DateTime?), createdBy (Int, admin userId), createdAt |
| `AdminAuditLog` | id, adminId, action (Text), targetUserId (Int?), note (Text), createdAt |

### Step 4 — Auth Setup

- `auth.ts` at project root + `app/api/auth/[...nextauth]/route.ts` catch-all
- NextAuth v5 Credentials provider
- Session exposes `user.id`, `user.role`, `user.username`
- Login flow: email + password → query User → bcrypt verify (work factor 12) → session with id/role/username
- Rate limiting check runs **before** bcrypt comparison
- Session re-validation on every request: refetch user from DB, confirm exists with same role. If deleted/role changed → session invalidated
- Session duration: 7 days
- Password policy: minimum 8 characters

### Step 5 — Rate Limiter (`lib/rate-limiter.ts`)

- In-memory Map: 10 failed attempts per IP per 15-minute window
- After 10 failures → IP blocked for 15 minutes
- Successful login resets counter
- Replace with Redis if scaling significantly

### Step 6 — CSRF Protection (`lib/csrf.ts`)

- Verify `Origin` header matches `NEXTAUTH_URL` on all state-changing routes
- Require `Content-Type: application/json` — reject plain form POSTs
- NextAuth handles CSRF for its own auth endpoints automatically

### Step 7 — Logging (`lib/logger.ts`)

- Every Route Handler logs: HTTP method, path, user ID (from session), response status code, processing time (ms)
- High-stakes actions (confirm, settle): also log trade/contract ID and outcome
- Errors: full stack trace, not just message
- Output to **Digital Ocean App Platform Runtime Logs** (no third-party service needed)

### Step 8 — Seed (`prisma/seed.ts`)

- Users: Sam (10,000, LIQUIDITY_PROVIDER), Admin (1,000, ADMIN), Ivan/James/Thy/Khang/Hieu (1,000 each, USER)
- For each: hash password with bcrypt (wf 12), insert User, insert BalanceLedger row (INITIAL_SEED)
- initiated_by = system (reserved ID 0)
- Real emails (provided before running seed)
- Temporary passwords output to console — users reset via Admin flow
- **No hardcoded user limit** — Admin creates more accounts anytime via admin panel

**Gate check — Day 1**: All users log in. Session returns correct ID/role. Sam = 10,000, others = 1,000. BalanceLedger has INITIAL_SEED rows for each user. 10 wrong passwords locks IP for 15 min.

---

## 7. Day 2 — Markets & Quotes

**Goal**: The site looks like a trading platform for the first time — contracts, quotes in a two-column layout, hints.

### Step 1 — Contract Route Handlers (`app/api/contracts/`)

- `GET /api/contracts` — all OPEN contracts. Each includes quotes + maker role (so UI detects LIQUIDITY_PROVIDER)
- `POST /api/contracts` — **Admin only** (role check first, 403 if not). Creates contract with title + description
- `GET /api/contracts/[id]` — full detail: all quotes (with maker roles), all hints (newest first), all confirmed OPEN trades

### Step 2 — Quote Route Handlers (`app/api/quotes/`)

- `POST /api/quotes` — USER or LIQUIDITY_PROVIDER only. **Admin blocked (403)**. Validation: `bid < ask` (mandatory), `size >= 1` (integer, no decimals). Clear error messages on failure
- `PATCH /api/quotes/[id]` — maker only. **Blocked if any PENDING take requests exist** → error "Resolve all pending requests before editing." Otherwise update bid/ask/size
- `DELETE /api/quotes/[id]` — maker only. Transaction: set all PENDING requests → REJECTED, notify each requester, set quote → CANCELLED

### Step 3 — Market Page — Two-Column Layout (`app/markets/[id]/page.tsx`)

- **Left column (primary)**: Sam's quote displayed large and visually prominent. Detected by `quote.maker.role === 'LIQUIDITY_PROVIDER'`. Below: take request form + HintPanel (hints newest-first)
- **Right column**: All other users' quotes in smaller list format. Each shows maker name, bid/ask/size, and take action (hidden if viewer is maker)
- **Below both columns**: All confirmed trades on this contract — visible to everyone

### Step 4 — Hints Route Handlers (`app/api/hints/`)

- Create/edit/delete: **LIQUIDITY_PROVIDER and ADMIN only**
- Each hint: text content + optional URL + optional display label
- URL without label → URL itself used as link text
- Links always open in new tab (`target="_blank"`)

### UI Components + Landing

- `ContractCard`, `QuoteCard` (prominent variant for LIQUIDITY_PROVIDER), `HintPanel`, `TakeRequestForm`
- Landing page at `app/page.tsx` listing all open contracts
- **Dark mode trading platform aesthetic** — dark backgrounds, accent colors for bid/ask/PnL, modern typography

**Gate check — Day 2**: Sam's quote large in left column. Other quotes in right column. `bid >= ask` → validation error, nothing saved. Sam + Admin can post hints. Hints with links show clickable text, open new tab.

---

## 8. Day 3 — Trading Flow

**Goal**: Full trading workflow end-to-end. Most complex day.

> **WARNING**: Margin calculator must be bulletproof before any trading routes are connected. A margin bug can allow over-trading and create unpayable liabilities.

### Step 1 — Margin Calculator (`lib/margin.ts`)

**Formula**: `Available Margin = Balance + Worst-Case P&L` (Worst-Case P&L ≤ 0)

- Accepts `userId`, returns available margin as integer
- Queries: all OPEN confirmed trades (user is taker OR maker) + all PENDING take requests submitted by user (where `expires_at > now UTC`)
- EXPIRED requests filtered out automatically (margin released immediately)
- Algorithm:
  1. Group by contract
  2. For each contract: gather all strike prices, generate test points (one below lowest, one above highest, one between each adjacent pair)
  3. At each test point: sum user's P&L across all trades and pending requests in that contract
  4. Worst case for contract = minimum across all test points
  5. Sum worst cases across all contracts (outcomes are independent)

**5 mandatory test cases** (must all pass before proceeding):
1. No trades, no pending → available = full balance
2. One OVER trade, strike 240, size 25 → worst case = −25, available = balance − 25
3. One OVER trade + one PENDING request size 50 → worst case = −25 + (−50) = −75, available = balance − 75
4. Two trades same contract, partial hedge → worst case ≠ naive sum (worked example: −20, not −80)
5. Two trades different contracts → worst cases summed independently

### Step 2 — P&L Logic (`lib/pnl.ts`)

- Pure function: `calculatePnl(takerSide, strike, settlementValue, size)` → `{ takerPnl, makerPnl }`
- Implements binary P&L table from Section 4 exactly
- Push case (X = strike) → both return exactly 0 (not null, not undefined)

### Step 3 — Submit Take Request (`app/api/take-requests/` POST)

Submission flow, in order:
1. Self-trade prevention: requester ≠ quote maker
2. Quote status OPEN and contract status OPEN
3. Lazy expiry cleanup: update PENDING requests on this quote where `expires_at < now` → EXPIRED
4. Size validation: `size >= 1` and `size <= quote.size`
5. Margin check for taker. Error: "Insufficient margin: you have X available, this trade requires Y"
6. Create TakeRequest: status = PENDING, `expires_at = now + 48h (UTC)`
7. Notify quote maker: "New take request on your quote for contract [title]"
8. Return created request

No Trade exists yet. Margin locked by pending request reflects immediately in subsequent calculations.

### Step 4 — Confirm Flow (`app/api/take-requests/[id]/confirm/` POST)

All-or-nothing Prisma transaction:
1. Verify TakeRequest status = PENDING
2. Verify `expires_at > now (UTC)` — if expired → "This request has expired"
3. Fetch Quote with row-level lock (`SELECT FOR UPDATE`) — prevent race conditions
4. Verify requested size ≤ current quote size
5. Re-run margin for taker (balance may have changed)
6. Re-run margin for maker (opposite side needs margin)
7. Determine strike: OVER → ask, UNDER → bid
8. Create Trade: taker, maker, takerSide, strike, size, status = OPEN
9. Update TakeRequest → CONFIRMED
10. Accept maker's new size input. If 0 → quote EXHAUSTED. Otherwise update size (any value ≥ 0, no upper bound)
11. Notify taker: "Your take request was confirmed — trade created on contract [title]"
12. Return created trade

**Maker UX**: Form pre-fills "new size" with `current_quote_size − trade_size`. Maker can change to any value.

**Multiple pending requests**: Displayed oldest-first (`created_at ASC`). Maker confirms/rejects in any order. Each confirmation = own transaction. Row-level lock prevents race conditions.

### Step 5 — Reject and Cancel

- **Reject** (`POST /api/take-requests/[id]/reject`): Quote maker only. → REJECTED. Notify taker. Idempotency required.
- **Cancel** (`POST /api/take-requests/[id]/cancel`): Taker only. → CANCELLED. Margin released immediately. **No idempotency key** (per plan v5).

### Step 6 — Idempotency (`lib/idempotency.ts`)

**Client side:**
1. Generate UUIDv7 before submit
2. Send as `Idempotency-Key: <UUIDv7>` header
3. Button disabled → "Processing…". Re-enables on server error (new key for retry)

**Server side:**
1. Validate header present → 400 if missing
2. Validate UUIDv7 format (regex) → 422 if invalid
3. Lookup by `(actorId, action, idempotencyKey)` composite index
4. Same key + same `request_hash` → return cached response
5. Same key + different `request_hash` → 422 "Same key, different payload"
6. New key → process normally, store result
7. Auto-delete after 24 hours

**Requires idempotency**: submit take request, confirm, reject
**No idempotency**: GET endpoints, quote CRUD, cancel take request

### Step 7 — Notifications (`app/api/notifications/` + NotificationPanel)

- `GET /api/notifications` — polled every 5 seconds, returns unread count + recent notifications
- `PATCH /api/notifications/read` — mark all as read
- NotificationPanel in navbar: badge with unread count
- Inside dropdown:
  - Quote owners see incoming take requests with **inline Confirm/Reject buttons** (no page navigation)
  - Traders see confirmation, rejection, settlement results

**Gate check — Day 3**: Take request → taker margin decreases → maker gets notification → confirm → trade appears in both positions → cancel different pending request → margin released. Margin enforced at both submission and confirmation.

---

## 9. Day 4 — Settlement & Leaderboard

**Goal**: Complete the full game loop — Admin enters real answer, coins change hands, ledger written, leaderboard updates.

### Step 1 — Settlement Flow (`app/api/contracts/[id]/settle/` POST)

Admin only. Single all-or-nothing Prisma transaction:
1. Reject all PENDING take requests on this contract → notify each requester
2. Cancel all OPEN quotes on this contract
3. For each OPEN trade on this contract:
   a. Calculate taker P&L and maker P&L using `lib/pnl.ts` (binary table from Section 4)
   b. Update trade: status = SETTLED, takerPnl = calculated, makerPnl = calculated
   c. Add takerPnl to taker's balance
   d. Add makerPnl to maker's balance
   e. Write BalanceLedger row for taker: delta = takerPnl, balanceAfter = new balance, eventType = SETTLEMENT, tradeId, contractId, initiatedBy = admin userId, note = human-readable description
   f. Write BalanceLedger row for maker: same structure
4. Update contract: status = SETTLED, settlementValue = X
5. Notify all affected users with their P&L result

**Push case (X = strike)**: Both P&L = 0, balances unchanged, BalanceLedger still writes 2 rows with delta = 0 (complete audit trail), trade still marked SETTLED.

**Post-settlement integrity check**: For each affected user, `SUM(delta)` from BalanceLedger vs current balance. If mismatch:
- Log detailed ERROR (userId, expected sum, actual balance, contractId)
- Notify all ADMIN users
- **Do NOT auto-rollback** — human must investigate

### Step 2 — Settlement UI (`app/admin/contracts/[id]/settle/page.tsx`)

- Admin enters real answer X, submits
- Shows all OPEN trades on this contract before settling (preview)

### Step 3 — Leaderboard (`app/leaderboard/page.tsx`)

- All users ranked by `SUM(delta)` from BalanceLedger where `eventType = SETTLEMENT`
- Authoritative P&L source (not current balance — that started at different amounts)
- Updates immediately after each settlement

### Step 4 — Positions (`app/positions/page.tsx`)

- Logged-in user's OPEN trades across all contracts
- Per position: contract title, side (OVER/UNDER), strike, size, win scenario, loss scenario (in coins)

### Step 5 — User API (`app/api/users/me/route.ts`)

- Returns: current balance, available margin, margin in use, count of open trades
- Used by dashboard/navbar

### Step 6 — Admin Panel

- `app/admin/page.tsx` — admin dashboard
- `app/admin/users/page.tsx` — create new user accounts (scalable, no user limit), generate password reset tokens
- `app/admin/contracts/page.tsx` — contract management (create, view, settle)

### Step 7 — Password Reset (`app/reset-password/page.tsx` + API)

- Admin generates reset token (1 hour expiry, signed string)
- Admin copies reset link, sends manually (Discord, etc.)
- User opens link, enters new password
- System validates token (not expired, not used), hashes with bcrypt, saves, marks token as used
- Admin never sees new password
- Logged in AdminAuditLog

### Step 8 — Health Check (`app/api/health/route.ts`)

- Returns: database connectivity status + current UTC time
- Digital Ocean App Platform can ping this under **Settings → Health Checks**

**Gate check — Day 4**: Full game loop works. Push case (X = strike) → P&L = 0, delta = 0. Leaderboard reflects correct net settled P&L. `SUM(delta) = balance` for all users.

---

## 10. Day 5 — Testing & Launch

**Goal**: No new features. Verify everything survives real use, then go live.

### Step 1 — Unit Tests (no database required)

**Margin calculator — 5 required test cases** (`__tests__/margin.test.ts`):
1. No trades, no pending → result = full balance
2. One OVER trade → worst case = −size
3. One OVER trade + one pending request → worst case = sum of both
4. Two trades same contract, partial offset → worst case ≠ naive sum
5. Two trades different contracts → summed independently

**P&L logic — 6 required test cases** (`__tests__/pnl.test.ts`):
1. OVER, X > strike → taker +size, maker −size
2. OVER, X < strike → taker −size, maker +size
3. OVER, X = strike → both exactly 0 (not null/undefined)
4. UNDER, X < strike → taker +size, maker −size
5. UNDER, X > strike → taker −size, maker +size
6. UNDER, X = strike → both exactly 0

Must pass 100% before deployment.

### Step 2 — Manual Edge Case Verification (12 scenarios)

| # | Scenario | How to Test | Expected Result |
|---|----------|------------|-----------------|
| 1 | Push/tie | Settle at exactly the strike | Both P&L = 0, delta = 0, trade SETTLED |
| 2 | 48h expiry | Set `expires_at` to past, query margin | Expired request no longer locks margin |
| 3 | Maker margin fail | Maker's balance too low after other trades | Confirm returns "insufficient margin", no trade |
| 4 | Taker recheck | Taker submits, balance decreases, maker confirms | Confirm fails due to taker margin |
| 5 | Quote edit block | Edit quote with PENDING request | Error "resolve pending requests first" |
| 6 | Race condition | Two confirms on same quote simultaneously | Only one succeeds |
| 7 | Self-trade | User takes own quote | Blocked "cannot take your own quote" |
| 8 | bid ≥ ask | Post quote where bid = ask | Validation error, nothing written |
| 9 | Admin trading | Admin posts quote or submits take request | HTTP 403 |
| 10 | Ledger integrity | After settlement, verify SUM(delta) = balance | No discrepancy |
| 11 | Idempotency dup | Same take request + same key twice | Cached response, no duplicate |
| 12 | Bad Idempotency-Key | Malformed header | HTTP 422 |

### Step 3 — Deployment

**Railway — database:**
1. PostgreSQL service already exists
2. Copy `DATABASE_URL` from Railway dashboard
3. `prisma migrate deploy` against production DB
4. Run seed script once
5. Verify all users exist with correct balances

**Digital Ocean App Platform — application:**
1. Go to [cloud.digitalocean.com](https://cloud.digitalocean.com) → **App Platform** → **Create App**
2. Connect GitHub → select `IterLight-Lab/trading-game-platform` → `main` branch
3. DO auto-detects Next.js. Confirm build = `npm run build`, run = `npm start`
4. Choose plan: **Basic** ($5/month)
5. Add environment variables (App-Level):
   - `DATABASE_URL` — from Railway
   - `NEXTAUTH_SECRET` — generated secret
   - `NEXTAUTH_URL` — `https://iterlight.com`
   - `RESET_TOKEN_SECRET` — generated secret
6. Deploy (3–5 min first deploy)

**Domain — iterlight.com:**
1. App Platform → Settings → Domains → Add Domain
2. Enter `iterlight.com` and `www.iterlight.com`
3. DO shows DNS records to add (CNAME or A records)
4. Add DNS records at registrar (Cloudflare, Namecheap, etc.)
5. DNS propagation: 5–30 min. SSL auto-provisioned
6. Verify `https://iterlight.com` loads with valid SSL

**Post-deployment checklist:**
- `NEXTAUTH_URL` = `https://iterlight.com` (not localhost)
- `https://iterlight.com/api/health` returns `{ status: "ok" }`
- Test login for all users on live URL

**Final gate check**: All participants log in at `iterlight.com`. Sam posts a quote, another player takes it, Sam confirms, Admin settles, leaderboard updates, BalanceLedger shows correct entries.

---

## 11. Production Hardening

### Race Condition Prevention
- Confirm route: `SELECT FOR UPDATE` on Quote inside transaction
- Two simultaneous confirms → one waits for the other to commit
- Margin check at submission = user feedback; margin check inside transaction = correctness guarantee

### Idempotency (Section 9)
- Frontend disables submit button
- Backend deduplicates by `(actor_id, action, idempotency_key)`
- Same key + same payload = cached result

### Logging
- Every Route Handler: method, path, userId, statusCode, processingTime
- High-stakes: tradeId/contractId + outcome
- Errors: full stack trace
- Output: **DO App Platform Runtime Logs** (Logs tab in dashboard)

### Health Check
- `GET /api/health` → DB connectivity + UTC time
- Configure under DO **Settings → Health Checks**

### Notification Retention Cron
- Archive >90 days → NotificationArchive table
- Delete >180 days from archive
- Runs at midnight UTC daily

---

## 12. Design Decisions Summary

| Topic | Decision |
|-------|---------|
| Trading model | Binary spread betting — OVER/UNDER, fixed ±size |
| Strike | OVER → ask, UNDER → bid |
| Bid/Ask | Thresholds, not probabilities. `bid < ask` enforced |
| Size | Integer coins, minimum 1, no decimals |
| Payout | Binary, not proportional |
| Margin | `available = balance + worst_case_pnl` (≤ 0) |
| Margin scope | Both trades and PENDING requests lock margin |
| Expired requests | Margin released immediately on expiry |
| Multiple pending | Allowed, no limit. Oldest-first. Maker chooses |
| Quote size after confirm | Maker inputs manually. Pre-fill suggestion. No upper bound |
| Admin trading | Blocked at API layer |
| BalanceLedger | Every balance change = ledger row. Integrity verified |
| Idempotency | UUIDv7 header, dedup by (actor, action, key) |
| **Hosting** | **Digital Ocean App Platform + Railway (PostgreSQL)** |
| **Domain** | **iterlight.com — DNS to App Platform, SSL auto** |
| Router | App Router only |
| Timezones | UTC everywhere |
| Password reset | Token-based via Admin, 1h expiry |
| Notification retention | Archive 90d, delete 180d, daily cron |
| Margin note | PENDING requests lock margin — intentional, prevents fake liquidity |
