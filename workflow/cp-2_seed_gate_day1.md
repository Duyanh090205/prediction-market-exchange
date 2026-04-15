# CP-2: Seed + Gate Check Day 1

**Covers**: Day 1 Step 8 (Seed Users)
**Status**: ⬜ Not Started
**Depends on**: CP-1 ✅

---

## What Gets Built

- [ ] `prisma/seed.ts` — creates initial users with correct roles and balances
- [ ] Sam: 10,000 coins, LIQUIDITY_PROVIDER
- [ ] Admin: 1,000 coins, ADMIN
- [ ] Ivan, James, Thy, Khang, Hieu: 1,000 coins each, USER
- [ ] All passwords: bcrypt hashed (work factor 12), minimum 8 characters
- [ ] For each user: BalanceLedger row with `eventType = INITIAL_SEED`, `delta = starting balance`, `balanceAfter = starting balance`, `initiatedBy = 0` (system), `note = "Initial seed"`
- [ ] Temporary passwords output to console (users reset via Admin flow later)
- [ ] **No hardcoded user limit** — Admin creates more accounts via admin panel anytime

---

## Pre-Requisites Before Running

> ⚠️ **Provide real email addresses for the initial users before this checkpoint runs.**

| User | Role | Balance | Email |
|------|------|---------|-------|
| Sam | LIQUIDITY_PROVIDER | 10,000 | _provide_ |
| Admin | ADMIN | 1,000 | _provide_ |
| Ivan | USER | 1,000 | _provide_ |
| James | USER | 1,000 | _provide_ |
| Thy | USER | 1,000 | _provide_ |
| Khang | USER | 1,000 | _provide_ |
| Hieu | USER | 1,000 | _provide_ |

---

## Gate Check — Full Day 1 Verification

```
1. npx prisma db seed             → Seed runs without errors
2. npx prisma studio → User       → 7 users, correct roles and balances
3. npx prisma studio → BalanceLedger → 7 rows, all INITIAL_SEED, correct deltas
4. Login as Sam                    → Session: role = LIQUIDITY_PROVIDER, balance = 10000
5. Login as Admin                  → Session: role = ADMIN, balance = 1000
6. Login as Ivan                   → Session: role = USER, balance = 1000
7. Wrong password x10              → 11th attempt: blocked for 15 minutes
8. Correct login after block       → Still blocked until 15 min window expires
9. Correct login resets counter    → After block expires, successful login works
```

---

## Notes

_Fill in during review:_
- 
