# CP-7: Settlement + Leaderboard + Positions

**Covers**: Day 4 — All Steps
**Status**: ⬜ Not Started
**Depends on**: CP-6 ✅

---

## What Gets Built

### Settlement (`app/api/contracts/[id]/settle/` POST + `app/admin/contracts/[id]/settle/page.tsx`)

- [ ] Admin only. Single all-or-nothing Prisma transaction:
  1. Reject all PENDING take requests on this contract → notify each
  2. Cancel all OPEN quotes on this contract
  3. For each OPEN trade:
     - Calculate P&L using `lib/pnl.ts` (binary table Section 4)
     - Update trade: status = SETTLED, takerPnl, makerPnl
     - Add takerPnl to taker's balance
     - Add makerPnl to maker's balance
     - Write BalanceLedger row for taker (SETTLEMENT, delta, balanceAfter, tradeId, contractId, initiatedBy = admin, human-readable note)
     - Write BalanceLedger row for maker (same structure)
  4. Update contract: status = SETTLED, settlementValue = X
  5. Notify all affected users with P&L result
- [ ] **Push case (X = strike)**: Both P&L = 0, balances unchanged, but still write 2 BalanceLedger rows with delta = 0, trade still marked SETTLED
- [ ] **Post-settlement integrity check**: `SUM(delta)` from BalanceLedger vs current balance. Mismatch → Log ERROR, notify all ADMINs, do NOT auto-rollback
- [ ] Settlement UI: Admin enters X, shows preview of OPEN trades before settling

### Leaderboard (`app/leaderboard/page.tsx`)

- [ ] All users ranked by `SUM(delta)` from BalanceLedger where `eventType = SETTLEMENT`
- [ ] Authoritative P&L source (not current balance)
- [ ] Updates immediately after each settlement

### Positions (`app/positions/page.tsx`)

- [ ] Logged-in user's OPEN trades across all contracts
- [ ] Per position: contract title, side (OVER/UNDER), strike, size, win scenario, loss scenario

### User API (`app/api/users/me/route.ts`)

- [ ] Returns: current balance, available margin, margin in use, count of open trades

### Admin Panel

- [ ] `app/admin/page.tsx` — admin dashboard
- [ ] `app/admin/users/page.tsx` — create new user accounts (scalable), generate password reset tokens
- [ ] `app/admin/contracts/page.tsx` — contract management (create, view, settle)

### Password Reset

- [ ] Admin generates token (1h expiry, signed string) → copies reset link → sends to user manually
- [ ] `app/reset-password/page.tsx` — user enters new password
- [ ] System validates: not expired, not used → bcrypt hash → save → mark token as used
- [ ] Admin never sees new password
- [ ] Logged in AdminAuditLog

### Health Check (`app/api/health/route.ts`)

- [ ] Returns: DB connectivity + current UTC time

---

## Gate Check — Full Day 4 Verification

```
1.  Create contract (as Admin)               → Contract OPEN
2.  Sam posts quote                          → Quote OPEN
3.  Ivan takes quote (OVER)                  → TakeRequest PENDING
4.  Sam confirms                             → Trade OPEN, correct strike
5.  Admin settles with X > strike            → Ivan wins (+size), Sam loses (−size)
6.  BalanceLedger                            → 2 SETTLEMENT rows, correct deltas
7.  Ivan's balance                           → Increased by size
8.  Sam's balance                            → Decreased by size
9.  Push case: settle at X = strike          → Both P&L = 0, delta = 0, trade SETTLED
10. Push case BalanceLedger                  → 2 rows with delta = 0 (audit trail maintained)
11. Leaderboard                              → Correct ranking by SUM(SETTLEMENT deltas)
12. Positions page                           → Shows OPEN trades with win/loss scenarios
13. /api/users/me                            → Correct balance, margin, open trade count
14. Integrity check                          → SUM(delta) = balance for all affected users
15. Admin creates new user                   → Works (no hardcoded limit)
16. Password reset flow                      → Token generated, link works, password changed
17. /api/health                              → { status: "ok", time: "..." }
```

---

## Notes

_Fill in during review:_
- 
