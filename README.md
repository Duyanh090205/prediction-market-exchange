# Prediction-Market Exchange

A working prediction-market exchange, built from the matching engine up: a central limit
order book with price-time priority, a margin engine that reserves against worst-case
loss, and atomic settlement.

Players quote and trade binary spread contracts - OVER/UNDER a strike price, with fixed
+/-size payouts. Orders execute instantly against the book; there is no manual
confirmation step anywhere in the execution path.

To be precise about what "working" claims: this was built as the engine for a private
trading game. The matching, margin and settlement paths are complete and tested, but it
has never taken live order flow.

**~15.6k lines - 103 tests - Next.js 15, PostgreSQL, Prisma, Socket.IO**

## Quickstart

```
npm install
npx jest                 # 67 unit tests, no database needed
```

The remaining 36 tests are integration tests gated behind a live Postgres. With one
available (see Local Development below):

```
RUN_DB_ITEST=1 npx jest  # all 103
```

> **Authorship.** I designed and built the matching engine, margin engine and settlement
> layer - 88% of the codebase. Deployment configuration and the SSO integration were
> contributed by teammates.

> **Live at https://prediction-market-exchange.onrender.com** — Render plus Neon Postgres,
> both free tier. Opening the root without an account shows a read-only order book;
> sign in with `demo@example.com` / `demo-trader-2027` to place orders against the
> real matching engine. It has never taken live order flow.

> **Design docs.** How this was planned before it was built - the spec, the phase-1
> tracker and a walkthrough - is in [`workflow/`](./workflow/).

## How It Works

1. **Admin** creates a contract — a question with one real numerical answer
2. **Market makers** post Bid/Ask/Size quotes on the order book
3. **Players** hit quotes instantly via LIMIT orders, or sweep the book with MARKET orders
4. Trades execute **atomically** — no manual confirmation needed
5. **Admin settles** the contract by entering the real answer — coins change hands
6. **Leaderboard** tracks realized P&L across all settled contracts

## User Roles

| Role | Who | Balance | Permissions |
|------|-----|---------|------------|
| **ADMIN** | Platform manager | 1,000 | Create contracts, settle contracts, create user accounts, generate password reset tokens. **Cannot trade.** |
| **LIQUIDITY_PROVIDER** | Designated market maker | 10,000 | Quotes displayed prominently on every market page. Can post hints. Trades like any user. |
| **USER** | All other players | 1,000 | Post quotes (single-sided OK), take positions, view leaderboard |

- **Admin password reset**: Admin generates a signed JWT token (1h expiry) → sends link to user via Discord → user sets new password. Admin never sees the password.
- **The market-maker role** is what makes those quotes appear large in the left column — enforced by checking `quote.maker.role === LIQUIDITY_PROVIDER`.
- Admin is **strictly blocked** from posting quotes or placing orders at the API layer.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router, Server + Client Components) |
| Database | PostgreSQL (Railway) |
| ORM | Prisma |
| Auth | NextAuth.js v5 (JWT strategy) |
| Real-time | Socket.IO (custom Node.js server) |
| Styling | Tailwind CSS |

## Project Structure

```
app/                        # Next.js App Router — pages & API routes
├── api/
│   ├── orders/             # ★ Matching Engine (LIMIT + MARKET)
│   ├── contracts/          # Contract CRUD + settlement
│   ├── quotes/             # Quote CRUD
│   ├── hints/              # Hint CRUD
│   ├── notifications/      # Notification polling + mark read
│   ├── trades/             # Trade management (admin)
│   ├── users/              # User info (me endpoint)
│   └── health/             # Health check
├── components/             # 12 React components
├── markets/[id]/           # Contract detail page (order book)
├── leaderboard/            # P&L rankings
├── positions/              # User's open trades
└── admin/                  # Admin panel (contracts, users, settle)

lib/                        # Business logic
├── matching-engine.ts      # ★ LIMIT + MARKET order execution
├── margin.ts               # Margin calculator (tx-aware, Double Margining)
├── pnl.ts                  # Binary P&L (OVER/UNDER × strike × size)
├── socket-client.ts        # Socket.IO client singleton
├── socket-events.ts        # Server-side WS event emitters
├── idempotency.ts          # UUIDv7 dedup
├── csrf.ts                 # CSRF protection
├── rate-limiter.ts         # Login rate limiter (10/15min per IP)
└── logger.ts               # Structured logging

server.js                   # Custom Node.js server (Next.js + Socket.IO)
prisma/schema.prisma        # Database schema (11 tables)
__tests__/                  # 35 unit tests (matching, margin, P&L)

workflow/                   # Documentation & planning
├── project-walkthrough.md  # ★ Complete project walkthrough
├── phase-1.md              # Checkpoint tracker
├── trading_platform_plan_v5.md  # Original master plan
└── hyperliquid_research_report.md  # HyperLiquid architecture research
```

## Local Development

### Prerequisites

- Node.js >= 18.17
- Docker Desktop (for local PostgreSQL)

### Setup

```powershell
# 1. Clone the repo (if you haven't already)
git clone https://github.com/Duyanh090205/prediction-market-exchange.git
cd prediction-market-exchange

# 2. Start local PostgreSQL (Run this exact command in PowerShell)
docker run -d --name trading-pg -e POSTGRES_PASSWORD=localpassword -e POSTGRES_DB=trading_game -p 5432:5432 postgres:16-alpine

# Note: If you already created the container previously, just start it:
# docker start trading-pg

# 3. Install dependencies
npm install

# 4. Set up environment variables
# Create .env.local from .env.example.
# For local dev, set both TRADING_DATABASE_URL and TRADING_DATABASE_DIRECT_URL
# to the same direct Postgres URL (no connection pool).

# 5. Apply committed migrations to your local database
npx prisma migrate deploy

# 6. Seed the database with the test users
npx prisma db seed

# 7. Start the server (Required for WebSockets to work)
node server.js
```

When you change `prisma/schema.prisma`, create a new migration with `npx prisma migrate dev --name <short_description>` against a local Postgres (Docker). **Review the generated SQL** — we only ship **additive** migrations (new tables/columns/indexes/enums); avoid `DROP TABLE`, `DROP COLUMN`, and destructive `ALTER` in new files. (One historical migration removed deprecated `TakeRequest`; do not use it as a template for new work.)

### Running Tests

```bash
# Unit tests (matching engine, margin, P&L)
npx jest

# Type checking
npx tsc --noEmit
```

## Production / App Platform builds

`npm run build` is **`next build` only** (no database access). Pending migrations run when the container starts: `npm start` → `scripts/start-with-migrate.js` → `prisma migrate deploy` → `server.js`. That matches how DigitalOcean routes traffic: **build workers often cannot reach a managed DB** (Prisma `P1001`), while the running service can.

Use `TRADING_DATABASE_DIRECT_URL` from the control panel’s **direct / non-pool** connection (port often differs from the pooler; both hosts may look similar). Wrong port or pool-only URL can also produce connection errors.

**Policy:** new migrations should be **additive only** (create/extend). Do not commit migrations that drop tables or columns unless you have an explicit maintenance window and backups.

### Environment Variables

| Variable | Description |
|----------|------------|
| `SKIP_DB_DEPLOY` | Set to `1` to skip `prisma migrate deploy` during `npm run build` (e.g. CI without Postgres) |
| `TRADING_DATABASE_URL` | PostgreSQL URL for the app at runtime (prod: DigitalOcean **pool** + `pgbouncer=true`) |
| `TRADING_DATABASE_DIRECT_URL` | Direct Postgres URL for **`prisma migrate deploy`** (no pool; required for reliable migrations on DO) |
| `NEXTAUTH_SECRET` | Random 32-byte base64 string for JWT signing |
| `NEXTAUTH_URL` | App URL (`http://localhost:3000` for dev) |
| `AUTH_TRUST_HOST` | Set `true` behind a reverse proxy (DigitalOcean App Platform, nginx) — avoids `UntrustedHost` |
| `TRADING_BASE_PATH` | Optional base path when mounted as sub-app (ex: `/trading`) |
| `NEXT_PUBLIC_TRADING_BASE_PATH` | Public base path for Socket.IO client (usually same as `TRADING_BASE_PATH`) |
| `RESET_TOKEN_SECRET` | Random 32-byte base64 string for password reset tokens |
| `CRON_SECRET` | Bearer token for cron cleanup endpoints |

## Core Systems

### Matching Engine
- **LIMIT orders**: Hit a specific quote by ID → instant atomic execution
- **MARKET orders**: Sweep best-priced quotes with slippage protection (`limitPrice`)
- **Double Margining**: Margin checked at submission AND inside the transaction
- **Race protection**: `SELECT FOR UPDATE` row locks prevent concurrent fill conflicts

### WebSocket (Real-Time)
- JWT-authenticated via NextAuth session cookie
- Room-based targeting: `user:<id>` + `contract:<id>`
- Events: `TRADE_EXECUTED`, `QUOTE_UPDATED`, `CONTRACT_SETTLED`
- 8-min keepalive for DigitalOcean compatibility

### Security
- NextAuth v5 JWT sessions with bcrypt (factor 12)
- Rate limiting, CSRF protection, security headers
- Admin blocked from all trading at API layer
- Idempotency (UUIDv7) on all state-changing operations

## Documentation

See [`workflow/`](./workflow/) for full documentation:

- [`project-walkthrough.md`](./workflow/project-walkthrough.md) — Complete project walkthrough (start to finish)
- [`phase-1.md`](./workflow/phase-1.md) — Phase 1 checkpoint tracker (all complete)
- [`trading_platform_plan_v5.md`](./workflow/trading_platform_plan_v5.md) — Original technical specification
- [`hyperliquid_research_report.md`](./workflow/hyperliquid_research_report.md) — HyperLiquid architecture research

## License

MIT — see [LICENSE](LICENSE).