# CP-1: Project Scaffold + Schema + Auth

**Covers**: Day 1 Steps 1–5 (Init, Headers, Schema, Auth, Rate Limiter)
**Status**: ⬜ Not Started

---

## What Gets Built

- [ ] Next.js App Router project initialized (TypeScript, Tailwind CSS, ESLint)
- [ ] **No `pages/` folder** — App Router only (Router consistency rule)
- [ ] Dependencies installed: `prisma`, `@prisma/client`, `next-auth@5`, `bcryptjs`, `uuid`
- [ ] `.env.local` updated with local Docker Postgres URL: `postgresql://postgres:localpassword@localhost:5432/trading_game`
- [ ] `next.config.ts` with 4 security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CSP)
- [ ] `prisma/schema.prisma` — all 12 tables defined (User, Contract, Quote, TakeRequest, Trade, Hint, Notification, NotificationArchive, BalanceLedger, IdempotencyKey, PasswordResetToken, AdminAuditLog)
- [ ] `prisma migrate dev` runs successfully — tables created in local Docker Postgres
- [ ] `auth.ts` + `app/api/auth/[...nextauth]/route.ts` — NextAuth v5 Credentials provider
- [ ] Session exposes `user.id`, `user.role`, `user.username`
- [ ] Session re-validation: refetch user from DB on every request, invalidate if deleted/role changed
- [ ] Session duration: 7 days
- [ ] Password policy: minimum 8 characters, bcrypt work factor 12
- [ ] `lib/rate-limiter.ts` — in-memory, 10 attempts / 15 min per IP, rate check runs before bcrypt
- [ ] `lib/csrf.ts` — Origin header verification + require Content-Type: application/json
- [ ] `lib/logger.ts` — structured logging (method, path, userId, statusCode, processingTime)

---

## Gate Check — How You Verify

```
1. npm run dev               → App starts without errors at localhost:3000
2. Login page renders        → Navigate to /api/auth/signin — page appears
3. Prisma Studio             → npx prisma studio — all 12 tables visible, empty
4. Schema validation         → npx prisma validate — no errors
5. No pages/ folder          → Confirm only app/ folder exists for routing
```

---

## Blocking Issues to Watch For

- Docker Postgres must be running: `docker start trading-game-db`
- `.env.local` must point to LOCAL database, not Railway
- NextAuth v5 is still in beta — pin specific version to avoid breaking changes
- Node v24.14.0 confirmed compatible

---

## Notes

_Fill in during review:_
- 
