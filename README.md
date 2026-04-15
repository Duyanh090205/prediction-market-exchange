# Trading Game Platform

A private prediction market web application for a group of friends. Players bet on numerical outcomes using binary spread betting — OVER/UNDER a strike price, with fixed ±size coin payouts.

## How It Works

1. **Admin** creates a contract — a question with one real numerical answer
2. **Sam** (the market maker) posts Bid/Ask/Size quotes
3. **Players** submit take requests on quotes, choosing Over or Under
4. The quote owner **confirms or rejects** each request
5. Confirmed requests become **binding trades**
6. **Admin settles** the contract by entering the real answer — coins change hands

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | PostgreSQL (Railway) |
| ORM | Prisma |
| Backend | Next.js App Router (Route Handlers) |
| Auth | NextAuth.js v5 |
| Frontend | Next.js (Server & Client Components) + Tailwind CSS |
| Hosting | Digital Ocean App Platform |
| Domain | iterlight.com |

## Project Structure

```
app/                    # Next.js App Router — pages & API routes
├── api/                # Route Handlers (business logic)
│   ├── auth/           # NextAuth catch-all
│   ├── contracts/      # Contract CRUD + settlement
│   ├── quotes/         # Quote CRUD
│   ├── take-requests/  # Submit, confirm, reject, cancel
│   ├── hints/          # Hint CRUD
│   ├── notifications/  # Notification polling + mark read
│   ├── users/          # User info (me endpoint)
│   └── health/         # Health check
├── markets/[id]/       # Two-column market page
├── leaderboard/        # P&L rankings
├── positions/          # User's open trades
├── admin/              # Admin panel (contracts, users, settle)
└── reset-password/     # Password reset page

lib/                    # Shared utilities
├── margin.ts           # Margin calculator (worst-case P&L simulation)
├── pnl.ts              # P&L calculation (binary spread betting)
├── idempotency.ts      # Idempotency-Key validation & dedup
├── rate-limiter.ts     # Login rate limiter (in-memory)
├── csrf.ts             # CSRF protection
└── logger.ts           # Structured logging

prisma/
├── schema.prisma       # Database schema (12 tables)
└── seed.ts             # Initial user seeding

workflow/               # Implementation plan & checkpoint tracking
```

## Local Development

### Prerequisites

- Node.js >= 18.17
- Docker Desktop (for local PostgreSQL)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/IterLight-Lab/trading-game-platform.git
cd trading-game-platform

# 2. Start local PostgreSQL
docker run --name trading-game-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=localpassword \
  -e POSTGRES_DB=trading_game \
  -p 5432:5432 \
  -d postgres:16

# 3. Install dependencies
npm install

# 4. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your secrets

# 5. Run database migrations
npx prisma migrate dev

# 6. Seed the database
npx prisma db seed

# 7. Start the dev server
npm run dev
```

### Environment Variables

| Variable | Description |
|----------|------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Random 32-byte base64 string for session encryption |
| `NEXTAUTH_URL` | App URL (`http://localhost:3000` for dev) |
| `RESET_TOKEN_SECRET` | Random 32-byte base64 string for password reset tokens |

## Documentation

See [`workflow/`](./workflow/) for the full implementation plan and checkpoint tracking:

- [`implementation_plan.md`](./workflow/implementation_plan.md) — Complete technical plan
- `cp-1` through `cp-8` — Individual checkpoint verification checklists

## License

Private — IterLight-Lab