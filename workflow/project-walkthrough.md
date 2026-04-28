# Project Walkthrough — Trading Game Platform

> Complete guide from zero to production. Every file, every decision, every system.

---

## 1. What We Built

A **prediction market** platform for binary spread betting — players bet on numerical outcomes (e.g., "What will BTC price be Friday?") OVER/UNDER a strike, fixed ±size coin payouts. Zero-sum, no house edge. Architecture is built to scale beyond a closed group: admin-gated public registration, instant CLOB matching, Redis-ready rate limiter and WebSocket layer.

**Live at**: [iterlight.com](https://iterlight.com)

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Client)                   │
│  Next.js Server Components + Client Components       │
│  Socket.IO Client (real-time updates)                │
└──────────────┬───────────────────┬──────────────────┘
               │ HTTP/REST         │ WebSocket
               ▼                   ▼
┌──────────────────────────────────────────────────────┐
│              server.js (Node.js)                      │
│  ┌─────────────────┐  ┌────────────────────────┐     │
│  │  Next.js Handler │  │  Socket.IO Server       │     │
│  │  (App Router)    │  │  JWT Auth from Cookie   │     │
│  │  API Routes      │  │  Room targeting         │     │
│  │  + Middleware    │  │  + Redis adapter (opt.) │     │
│  └────────┬────────┘  └───────────┬────────────┘     │
│           │                       │                   │
│  ┌────────▼───────────────────────▼────────────┐     │
│  │           lib/ (Business Logic)              │     │
│  │  matching-engine.ts  margin.ts  pnl.ts       │     │
│  │  audit.ts  idempotency.ts  csrf.ts           │     │
│  │  rate-limiter.ts (in-memory | Redis)         │     │
│  │  socket-redis.ts  theme.ts                   │     │
│  └────────────────────┬────────────────────────┘     │
└───────────────────────┼──────────────────────────────┘
                        │ Prisma ORM
                        ▼
              ┌──────────────────┐        ┌──────────┐
              │   PostgreSQL     │        │  Redis   │
              │   (Railway)      │        │  (opt.)  │
              │   11 tables      │        └──────────┘
              └──────────────────┘
```

---

## 3. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 15 (App Router) | Server + Client components, API routes, SSR |
| Database | PostgreSQL (Railway) | ACID transactions, SELECT FOR UPDATE locks |
| ORM | Prisma 6 | Type-safe queries, migrations |
| Auth | NextAuth v5 (JWT) | 30 s cached session re-validation, role + status checks |
| Real-time | Socket.IO + custom `server.js` | Bidirectional WebSocket with rooms, optional Redis adapter |
| Cache / scale | Optional Redis (`REDIS_URL`) | Rate limiter store + Socket.IO multi-pod adapter |
| Hosting | DigitalOcean App Platform | Auto-deploy from GitHub, SSL, custom domain |
| Domain | iterlight.com | Cloudflare DNS → DO App Platform |

---

## 4. Database Schema (11 Tables)

Defined in `prisma/schema.prisma`:

| Table | Purpose |
|-------|---------|
| `User` | Accounts: username, email, hashed password, balance, role, status (PENDING/ACTIVE/SUSPENDED), approvedAt, approvedBy |
| `Contract` | Markets: title, description, status (OPEN/SETTLED), `minPrice`, `maxPrice`, `settlementValue` |
| `Quote` | Order book: maker, bid, ask, size, status |
| `Trade` | Confirmed positions: taker, maker, side, strike, size, P&L, `idempotencyKey` (unique with quoteId) |
| `Hint` | Market maker's hints: text + optional URL |
| `Notification` | In-app alerts with read tracking |
| `NotificationArchive` | 90-day archived notifications, `originalId` unique |
| `BalanceLedger` | Audit trail of every balance change. Indexed by (userId, createdAt). `initiatedBy` nullable. EventType: INITIAL_SEED / SETTLEMENT / ADMIN_ADJUSTMENT |
| `IdempotencyKey` | Dedup by (actor, action, key), 24 h TTL |
| `PasswordResetToken` | Admin-generated, 1 h expiry, signed JWT |
| `AdminAuditLog` | Admin action history with `targetType` / `targetId` / `metadata` (JSONB) / `ipAddress` |

The legacy `TakeRequest` table has been dropped (matching engine replaces the take-request flow).

### Key Relationships
```
Contract 1──* Quote
Contract 1──* Trade
Contract 1──* Hint
User 1──* Quote (as maker)
User 1──* Trade (as taker or maker)
User 1──* Notification
User 1──* BalanceLedger
```

---

## 5. User Roles, Status & Permissions

| Role | Default Balance | Can Trade | Can Post Quotes | Can Settle | Notes |
|------|---------|-----------|-----------------|-----------|---------|
| ADMIN | configured | ❌ | ❌ | ✅ | Approves accounts, adjusts balances, settles, audits |
| LIQUIDITY_PROVIDER | configured | ✅ | ✅ (two-sided) | ❌ | Quote shown prominently, can post hints |
| USER | configured | ✅ | ✅ (one-sided OK) | ❌ | Standard player |

Status lifecycle:

```
PENDING ──admin approve──▶ ACTIVE ──admin suspend──▶ SUSPENDED
                                  ◀──admin reactivate──
PENDING ──admin deny──▶ (deleted)
```

PENDING and SUSPENDED users cannot establish a session. The credentials provider rejects them with a clear error.

---

## 6. Trading Model — Binary Spread Betting

**Quote**: Maker posts `Bid / Ask × Size` (e.g., `220 / 240 × 25`) inside a contract's price band.

**Taking a position**:
- Taker picks **OVER** → strike = Ask
- Taker picks **UNDER** → strike = Bid

**Settlement**: Admin enters real answer X.

| Taker Side | Result | Taker P&L | Maker P&L |
|-----------|--------|-----------|-----------|
| OVER | X > strike | +size | −size |
| OVER | X < strike | −size | +size |
| OVER | X = strike | 0 (push) | 0 (push) |
| UNDER | X < strike | +size | −size |
| UNDER | X > strike | −size | +size |
| UNDER | X = strike | 0 (push) | 0 (push) |

UI colour convention (single source of truth in `lib/theme.ts`): **OVER = red**, **UNDER = green**.

---

## 7. Margin System

```
Available Margin = Balance + Σ worstCaseForContract(positions per contract)
```

The margin calculator (`lib/margin.ts`):
1. Reads balance + all OPEN trades for the user
2. Groups by contract
3. Generates test points: every strike (push case captured), midpoints, ±1 boundary
4. Simulates P&L at each test point, takes the minimum per contract
5. Sums worst cases across all contracts

**Double Margining**:
- **Submission gate**: pre-flight check outside the transaction (cheap fail-fast)
- **Execution check**: snapshot taker + maker inside the `prisma.$transaction`, then update the snapshot in memory per fill via `incrementalWorstCase` + binary-search cap (`maxFillByMargin`). No per-iteration re-query of the full margin state.

A maker who posts a new quote must have `availableMargin ≥ size` upfront — toxic quotes are blocked at post time, not just at execution.

---

## 8. Matching Engine (`lib/matching-engine.ts`)

The instant CLOB. Two execution modes:

### LIMIT Order
Hit a specific quote by ID. Single atomic transaction:
1. Lock quote with `SELECT FOR UPDATE`
2. Validate: not self-trade, correct contract, side offered
3. Snapshot taker margin and maker margin once
4. Compute `fillSize = min(quote inventory, taker cap, maker cap)`
5. If `fillSize === 0` and maker cap = 0 → cancel toxic quote + throw `MakerMarginError`
6. Otherwise create the Trade (with `idempotencyKey`), decrement quote, notify maker

### MARKET Order (Sweep)
1. Fetch OPEN quotes sorted by price-time priority (FIFO at each price level)
2. Snapshot taker margin once; per-maker snapshots cached per quote owner
3. For each quote: skip own quotes, check slippage limit, compute caps
4. **Partial fill** if taker / maker margin limited; **cancel and continue** if maker margin = 0
5. Stop on slippage breach, taker exhaustion, or empty book
6. Mutate snapshots in memory after each fill so subsequent caps reflect the new position

### Security Hardening
| Fix | What |
|-----|------|
| D1 | Margin reads use `tx` client inside transaction |
| D2 | WebSocket auth via NextAuth JWT cookie verification |
| D3 | Taker double-margin at execution time |
| S1 | ContractId mismatch guard |
| S2 | Hard size ceiling 10 000 + price-band validation on `limitPrice` |
| L3 | Client debounce (300 ms) for burst WS events |
| L4 | Chained `.to()` prevents duplicate WS events |
| Idem | `Trade.idempotencyKey` unique with `quoteId` for hard dedup |
| Integrity | Settlement integrity check inside the transaction; abort on mismatch |

---

## 9. WebSocket Infrastructure

### Server (`server.js`)
- Custom Node.js server wrapping Next.js + Socket.IO
- **Auth**: parses NextAuth session cookie → `decode()` JWT with `NEXTAUTH_SECRET` → extracts verified userId
- **Rooms**: `user:<id>` (portfolio) + `contract:<id>` (order book)
- **Keepalive**: 8-min ping interval (DigitalOcean 10-min timeout)
- **Multi-pod**: when `REDIS_URL` is set, lazy `require("@socket.io/redis-adapter")` attaches a Redis pub/sub adapter so emits reach sockets on any node

### Client (`lib/socket-client.ts`)
- Singleton with `withCredentials: true`
- Auto-reconnect with exponential backoff (1 s → 30 s)
- WebSocket transport first, polling fallback

### Events
| Event | Emitted When | Rooms |
|-------|-------------|-------|
| `TRADE_EXECUTED` | Order fills | user:taker, user:maker, contract:id |
| `QUOTE_UPDATED` | Quote changes | contract:id |
| `CONTRACT_SETTLED` | Admin settles | contract:id |

---

## 10. API Route Map

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/register` | Public | Create PENDING account; rate-limited 5/h/IP |
| POST | `/api/auth/reset-password` | Public (token) | Set new password from admin-issued JWT |
| POST | `/api/orders` | USER/LP | Place LIMIT or MARKET order (instant) |
| GET/POST | `/api/contracts` | All / Admin or LP | List or create contracts (with price band) |
| GET | `/api/contracts/[id]` | All | Contract detail + quotes + trades |
| DELETE | `/api/contracts/[id]` | Admin | Delete OPEN contract with no trades; audited |
| POST | `/api/contracts/[id]/settle` | Admin | Settle with final value; idempotent; integrity-checked |
| POST | `/api/quotes` | USER/LP | Post a new quote (margin + price band) |
| PATCH | `/api/quotes/[id]` | Maker | Edit quote (margin + price band re-checked) |
| DELETE | `/api/quotes/[id]` | Maker / Admin | Cancel quote (admin path audited) |
| POST | `/api/hints` | LP / Admin | Post a hint |
| PATCH | `/api/hints/[id]` | Author | Edit hint |
| DELETE | `/api/hints/[id]` | Author / Admin | Delete hint |
| GET | `/api/notifications` | All | Unread count + recent notifications |
| PATCH | `/api/notifications/read` | All | Mark all read |
| GET | `/api/users/me` | All | Balance + margin info |
| GET | `/api/health` | Public | DB connectivity + UTC time |
| DELETE | `/api/trades/[id]` | Admin | Delete OPEN trade (audited) |
| GET/POST | `/api/admin/users` | Admin | List users / admin-create (skips approval) |
| PATCH | `/api/admin/users/[id]` | Admin | approve / deny / suspend / reactivate / adjust_balance |
| POST | `/api/admin/password-reset` | Admin | Generate 1-h reset link |
| GET | `/api/admin/audit-log` | Admin | Filterable admin action history |
| GET | `/api/cron/notifications` | Bearer | Archive at 90 d, delete at 180 d |
| GET | `/api/cron/idempotency` | Bearer | Cleanup idempotency keys > 24 h |

---

## 11. Frontend Components

| Component | Type | Purpose |
|-----------|------|---------|
| `Navbar` | Server | Navigation + session info + PortfolioLive |
| `PortfolioLive` | Client | WebSocket listener → debounced `router.refresh()` |
| `ContractCard` | Server | Market card with stats |
| `QuoteCard` | Client | Quote display (prominent LP / compact player) |
| `PostQuoteForm` | Client | Create quotes (price-band aware) |
| `QuoteActions` | Client | Edit/cancel quote controls |
| `LimitOrderForm` | Client | OVER/UNDER buttons with disabled-state explanations when a side is missing |
| `MarketOrderForm` | Client | Sweep form (price-band aware) |
| `NotificationPanel` | Client | Dropdown with badge, polls every 5 s |
| `HintPanel` | Client | Hints display + post form |
| `SignOutButton` | Client | Logout |
| `AdminQuoteDelete` | Client | Admin quote cancellation |
| `AdminTradeDelete` | Client | Admin trade deletion |
| `AdminDeleteMarketButton` | Client | Admin contract deletion |

---

## 12. Test Coverage

### Unit Tests (35 total)
```
__tests__/matching.test.ts  — 23 tests
__tests__/margin.test.ts    — 6 tests
__tests__/pnl.test.ts       — 6 tests
```

### End-to-End Smoke (`scripts/local-only/smoke-test.js`, 26 steps)
Tests via real HTTP against a live dev server with real NextAuth sessions:
- CSRF guard rejects POST without Origin
- Register creates PENDING / 0 balance
- PENDING user cannot establish session
- Admin approve → ACTIVE + balance + INITIAL_SEED ledger + audit row
- Approved user can sign in
- Contract creation with price band
- Quote rejection outside band
- Quote rejection when size exceeds maker margin
- Valid quote posts
- LIMIT order fills instantly
- Idempotency replay returns cached response, no duplicate trade
- MARKET sweep fills
- limitPrice outside band rejected
- Settlement runs, balance integrity holds
- Audit log records SETTLE_CONTRACT
- Admin adjust_balance, suspend → reactivate
- Audit log endpoint filters
- Non-admin gets 403 on admin endpoints

---

## 13. Security Checklist

| Layer | Protection |
|-------|-----------|
| Auth | NextAuth v5 JWT, bcrypt factor 12, 7-day sessions, 30 s session DB cache |
| Account gate | PENDING / SUSPENDED users blocked at credentials provider |
| Rate Limit | 10 attempts/15 min/IP login, 5 attempts/h/IP register; pluggable Redis backend |
| CSRF | Strict origin (Origin OR Referer) matches NEXTAUTH_URL; refuses if NEXTAUTH_URL unset; Content-Type: application/json on POST/PUT/PATCH |
| Headers | X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, dev/prod CSP, HSTS in prod |
| SQL | Prisma parameterized queries (no raw SQL except `SELECT FOR UPDATE` raw query in matching engine) |
| Race Conditions | `SELECT FOR UPDATE` row locks in transactions |
| Margin | Snapshot-based double-checked inside `prisma.$transaction` |
| WebSocket | JWT verification from session cookie; userId never trusted from client |
| Idempotency | UUIDv7 dedup by (actor, action, key); also persisted on Trade for hard dedup |
| Admin actions | Centralised `logAdminAction` writes AdminAuditLog atomically with the action it records |
| Balance integrity | Settlement aborts on `balance != SUM(ledger.delta)` mismatch and notifies all admins |

---

## 14. Deployment

### Infrastructure
```
GitHub (main) ──auto-deploy──▶ DigitalOcean App Platform
                                    │
                              ┌─────┴─────┐
                              │ server.js  │ ← node server.js
                              │ Next.js +  │
                              │ Socket.IO  │
                              │ (+Redis    │
                              │  adapter)  │
                              └─────┬─────┘
                                    │ Prisma
                                    ▼
                              Railway PostgreSQL
                                    +
                              Redis (optional)
```

### Required Environment Variables
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | JWT signing secret |
| `NEXTAUTH_URL` | App URL (https://iterlight.com) — also used by CSRF guard |
| `RESET_TOKEN_SECRET` | Password reset JWT secret |
| `CRON_SECRET` | Bearer token for cron endpoints |

### Optional Environment Variables
| Variable | Effect |
|----------|--------|
| `REDIS_URL` | Activates Redis-backed rate limiter + Socket.IO redis adapter (multi-pod) |

If `REDIS_URL` is set, install the optional packages: `npm install ioredis @socket.io/redis-adapter`.

---

## 15. File Structure

```
trading-game-platform/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── orders/route.ts       # ★ Matching Engine endpoint
│   │   ├── contracts/            # CRUD + settlement
│   │   ├── quotes/               # Quote management
│   │   ├── hints/                # Hint CRUD
│   │   ├── notifications/        # Notification polling
│   │   ├── trades/               # Trade deletion (admin)
│   │   ├── users/                # User info (me endpoint)
│   │   ├── admin/                # users/[id], audit-log, password-reset
│   │   ├── auth/                 # NextAuth catch-all + register + reset-password
│   │   ├── cron/                 # Cleanup jobs
│   │   └── health/               # Health check
│   ├── components/               # React components
│   ├── markets/[id]/             # Contract detail page
│   ├── markets/create/           # Contract creation form (with price band)
│   ├── leaderboard/              # P&L rankings
│   ├── positions/                # Open trades
│   ├── admin/                    # page, users, contracts, audit-log
│   ├── login/                    # Login page
│   ├── register/                 # Public register (queues PENDING)
│   └── reset-password/           # Password reset
├── lib/                          # Business logic
│   ├── matching-engine.ts        # ★ LIMIT + MARKET execution
│   ├── margin.ts                 # Margin calculator (snapshot-aware)
│   ├── pnl.ts                    # Binary P&L calculation
│   ├── audit.ts                  # logAdminAction helper
│   ├── socket-client.ts          # Socket.IO client singleton
│   ├── socket-events.ts          # Server-side event emitters
│   ├── socket-redis.ts           # Optional Redis adapter
│   ├── idempotency.ts            # Typed action keys + UUIDv7 dedup
│   ├── csrf.ts                   # Strict origin validation
│   ├── rate-limiter.ts           # Pluggable in-memory | Redis
│   ├── theme.ts                  # OVER / UNDER colour single source
│   ├── logger.ts                 # Structured logging + body sanitiser
│   └── prisma.ts                 # Prisma singleton
├── prisma/
│   ├── schema.prisma             # 11-table schema
│   ├── migrations/               # All historical migrations
│   └── seed.ts                   # Initial user seeding
├── __tests__/                    # 35 unit tests
├── scripts/local-only/           # Guarded dev scripts (smoke-test, reset_passwords, …)
├── server.js                     # Custom Node.js server (Next.js + Socket.IO + optional Redis adapter)
├── auth.ts                       # NextAuth — credentials, status gate, 30 s session cache
├── auth.config.ts                # Auth options (JWT strategy)
├── middleware.ts                 # Route protection middleware
├── next.config.ts                # Headers (HSTS prod, dev/prod CSP)
└── workflow/                     # Documentation
    ├── trading_platform_plan_v5.md   # Updated master plan
    ├── phase-1.md                    # Checkpoint tracker
    ├── hyperliquid_research_report.md # Research: HyperLiquid architecture
    └── project-walkthrough.md        # ★ This document
```

---

## 16. Development Timeline

| Phase | What was built |
|-------|---------------|
| CP-1 | Scaffold, schema, auth (PENDING/ACTIVE/SUSPENDED), security headers, rate limiting (pluggable), CSRF (strict), audit helper |
| CP-2 | User seeding, admin approval queue, lifecycle actions, audit log API + UI |
| CP-3 | Contract/Quote APIs with per-contract price band, two-column market UI |
| CP-4 | Hints system (LP/Admin only) |
| CP-5 | Margin calculator (test points fixed), instant matching engine, idempotency persisted on Trade |
| CP-6 | Notification system (no take-request residue) |
| CP-7 | Settlement with in-transaction integrity check, leaderboard, positions, admin tools |
| CP-8 | Unit tests (35), end-to-end smoke (26), production hardening, build verification |
| Final | TakeRequest dropped, snapshot-based double margining, partial-fill semantics, optional Redis adapter for scale |

---

## 17. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Binary (not proportional) payouts | Simple, easy to understand for new traders |
| Instant CLOB matching | Removes accept/reject friction, mirrors real exchange UX |
| Per-contract price band | Enables many market types (0–100, 50–150, …) without code changes |
| Admin-gated registration (PENDING) | Public sign-up without Sybil exposure; admin grants balance + writes ledger atomically |
| Snapshot-based double margining | One read per side per transaction instead of N+1 inside the sweep |
| Partial-fill semantics | Real-trading-platform behaviour — a maker with limited margin can still honour a smaller fill |
| Toxic-quote auto-cancel | A maker with zero margin gets their stale quote cancelled mid-sweep without aborting the order |
| Settlement integrity inside transaction | Balance/ledger mismatch aborts the entire settlement; admins are notified out-of-band |
| AdminAuditLog on every destructive action | Forensic accountability — captures admin / action / target / metadata / IP atomically with the action |
| Custom server.js | Required to run Socket.IO alongside Next.js on the same port |
| Optional Redis adapter | Single-pod default; set `REDIS_URL` to scale rate limiter + WS layer horizontally |
| 30 s session DB cache | Cuts session lookups by 95 % at scale; status / role changes propagate within 30 s |
| JWT sessions (not DB) | Stateless, faster, works with WebSocket cookie auth |
| SELECT FOR UPDATE | Pessimistic locking prevents concurrent fill races |
| Debounced client refresh | A 5-quote sweep fires 11 events → 1 router.refresh |

---

## 18. What's Next (Phase 2)

A market-maker bot ecosystem — automated quote management against the same `/api/orders` and `/api/quotes` endpoints any human player uses. Detailed in a separate plan.
