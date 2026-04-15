# CP-8: Tests + Production Hardening

**Covers**: Day 5 Steps 1–2 (Unit Tests + Edge Cases + Production Hardening)
**Status**: ⬜ Not Started
**Depends on**: CP-7 ✅

---

## What Gets Built

### Unit Tests (must pass 100% — no database required)

**`__tests__/margin.test.ts`** — 5 required cases:
- [ ] No trades, no pending → result = full balance
- [ ] One OVER trade → worst case = −size
- [ ] OVER trade + pending request → worst case = sum of both
- [ ] Two trades same contract, partial offset → worst case ≠ naive sum
- [ ] Two trades different contracts → summed independently

**`__tests__/pnl.test.ts`** — 6 required cases:
- [ ] OVER, X > strike → taker +size, maker −size
- [ ] OVER, X < strike → taker −size, maker +size
- [ ] OVER, X = strike → both exactly 0 (not null/undefined)
- [ ] UNDER, X < strike → taker +size, maker −size
- [ ] UNDER, X > strike → taker −size, maker +size
- [ ] UNDER, X = strike → both exactly 0

### Manual Edge Case Verification (12 scenarios)

- [ ] 1. **Push/tie**: Settle at exactly the strike → Both P&L = 0, delta = 0, trade SETTLED
- [ ] 2. **48h expiry**: Set `expires_at` to past → Expired request doesn't lock margin
- [ ] 3. **Maker margin fail**: Maker balance too low → Confirm returns "insufficient margin"
- [ ] 4. **Taker recheck**: Balance decreases after submit → Confirm fails
- [ ] 5. **Quote edit block**: Edit quote with PENDING request → Error
- [ ] 6. **Race condition**: Two confirms on same quote → Only one succeeds
- [ ] 7. **Self-trade**: Take own quote → Blocked
- [ ] 8. **bid ≥ ask**: Post quote bid = ask → Validation error
- [ ] 9. **Admin trading**: Admin posts quote or takes → 403
- [ ] 10. **Ledger integrity**: After settlement → `SUM(delta) = balance`
- [ ] 11. **Idempotency duplicate**: Same key twice → Cached response
- [ ] 12. **Bad Idempotency-Key**: Malformed header → 422

### Production Hardening

- [ ] Race condition prevention: `SELECT FOR UPDATE` on Quote in confirm transaction
- [ ] Idempotency: full Section 9 spec (client disables button, server deduplicates)
- [ ] Logging: all routes log method/path/userId/statusCode/processingTime. High-stakes include trade/contract ID. Errors = full stack trace. Output → **DO App Platform Runtime Logs**
- [ ] Health check: `GET /api/health` → DB connectivity + UTC time. Configure under **DO Settings → Health Checks**
- [ ] Notification retention cron: archive >90 days, delete >180 days, midnight UTC daily
- [ ] IdempotencyKey cleanup: auto-delete after 24 hours

---

## Gate Check — How You Verify

```
1.  npm test                    → All 11 test cases pass (5 margin + 6 P&L)
2.  Edge case 1-12              → All 12 scenarios produce expected results
3.  npm run build               → Production build succeeds with no errors
4.  GET /api/health             → Returns { status: "ok", time: "..." }
5.  Logging                     → Route Handler logs visible in console
6.  Idempotency cleanup         → Expired keys are removed
```

After CP-8 passes, deployment to **Digital Ocean App Platform + iterlight.com** is a separate step.

---

## Deployment Checklist (after CP-8)

### Railway — Database
```
1. PostgreSQL service exists
2. Copy DATABASE_URL from Railway dashboard
3. prisma migrate deploy (against production DB)
4. Run seed script once
5. Verify all users exist with correct balances
```

### Digital Ocean App Platform — Application
```
1. cloud.digitalocean.com → App Platform → Create App
2. Connect GitHub → IterLight-Lab/trading-game-platform → main branch
3. DO auto-detects Next.js. Build = npm run build, Run = npm start
4. Plan: Basic ($5/month)
5. Environment variables (App-Level):
   - DATABASE_URL = Railway URL
   - NEXTAUTH_SECRET = generated secret
   - NEXTAUTH_URL = https://iterlight.com
   - RESET_TOKEN_SECRET = generated secret
6. Deploy (3–5 min)
```

### Domain — iterlight.com
```
1. App Platform → Settings → Domains → Add Domain
2. Enter iterlight.com + www.iterlight.com
3. Add DNS records at registrar (CNAME/A records shown by DO)
4. DNS propagation: 5–30 min, SSL auto-provisioned
5. Verify https://iterlight.com loads with valid SSL
```

### Post-Deployment
```
- NEXTAUTH_URL = https://iterlight.com (not localhost)
- https://iterlight.com/api/health → { status: "ok" }
- Test login for all users on live URL
```

### Final Gate Check
```
All participants log in at iterlight.com. Sam posts a quote, another player
takes it, Sam confirms, Admin settles, leaderboard updates correctly,
BalanceLedger shows correct entries for all affected users.
```

---

## Notes

_Fill in during review:_
- 
