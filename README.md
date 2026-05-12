# Trading Game Platform

A private prediction market for a group of friends. Players bet on numerical outcomes using binary spread betting — OVER/UNDER a strike price, with fixed ±size coin payouts. Features an instant-execution matching engine with Double Margining and real-time WebSocket updates.

**Live at**: [marketgame.iterlight.com](https://marketgame.iterlight.com)

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
| **LIQUIDITY_PROVIDER** | Sam (primary market maker) | 10,000 | Quotes displayed prominently on every market page. Can post hints. Trades like any user. |
| **USER** | All other players | 1,000 | Post quotes (single-sided OK), take positions, view leaderboard |

- **Admin password reset**: Admin generates a signed JWT token (1h expiry) → sends link to user via Discord → user sets new password. Admin never sees the password.
- **Sam's role** is what makes his quotes appear large in the left column — enforced by checking `quote.maker.role === LIQUIDITY_PROVIDER`.
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
| Hosting | DigitalOcean App Platform |
| Domain | marketgame.iterlight.com |

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
git clone https://github.com/IterLight-Lab/trading-game-platform.git
cd trading-game-platform

# 2. Start local PostgreSQL (Run this exact command in PowerShell)
docker run -d --name trading-pg -e POSTGRES_PASSWORD=localpassword -e POSTGRES_DB=trading_game -p 5432:5432 postgres:16-alpine

# Note: If you already created the container previously, just start it:
# docker start trading-pg

# 3. Install dependencies
npm install

# 4. Set up environment variables
# Copy .env.local from another team member, or create it from .env.example.
# For local dev, set both TRADING_DATABASE_URL and TRADING_DATABASE_DIRECT_URL
# to the same direct Postgres URL (no connection pool).

# 5. Apply the schema to your local database (no migration files required)
npx prisma db push

# 6. Seed the database with the test users
npx prisma db seed

# 7. Start the server (Required for WebSockets to work)
node server.js
```

### Running Tests

```bash
# Unit tests (matching engine, margin, P&L)
npx jest

# Type checking
npx tsc --noEmit
```

## Production / App Platform builds

`npm run build` runs `scripts/db-deploy.mjs` first, which executes **`prisma db push`** when `TRADING_DATABASE_URL` or `TRADING_DATABASE_DIRECT_URL` is set. That creates or updates tables from `prisma/schema.prisma` on an empty database (no shadow DB; suitable for managed Postgres). It is skipped when those env vars are absent so local `npm run build` without Docker still works.

For schema changes you control, consider moving to versioned **`prisma migrate deploy`** in CI later; `db push` is the pragmatic default until migration history exists.

### Environment Variables

| Variable | Description |
|----------|------------|
| `SKIP_DB_DEPLOY` | Set to `1` to skip `prisma db push` during `npm run build` (e.g. CI without Postgres) |
| `TRADING_DATABASE_URL` | PostgreSQL URL for the app at runtime (prod: DigitalOcean **pool** + `pgbouncer=true`) |
| `TRADING_DATABASE_DIRECT_URL` | Direct Postgres URL for **`prisma db push`** / migrate (no pool; same DB as Overview connection details) |
| `NEXTAUTH_SECRET` | Random 32-byte base64 string for JWT signing |
| `NEXTAUTH_URL` | App URL (`http://localhost:3000` for dev) |
| `AUTH_TRUST_HOST` | Set `true` behind a reverse proxy (DigitalOcean App Platform, nginx) — avoids `UntrustedHost` |
| `TRADING_BASE_PATH` | Optional base path when mounted as sub-app (ex: `/trading`) |
| `NEXT_PUBLIC_TRADING_BASE_PATH` | Public base path for Socket.IO client (usually same as `TRADING_BASE_PATH`) |
| `LAB_SSO_SHARED_SECRET` | Shared secret used to verify Lab-issued SSO handoff token |
| `LAB_SSO_ISSUER` | Expected JWT issuer for handoff token (`iterlight-lab-backend`) |
| `LAB_SSO_AUDIENCE` | Expected JWT audience (`trading-game-platform`) |
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

Private — IterLight-Lab