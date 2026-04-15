# CP-5: Margin Calculator + Trading APIs

**Covers**: Day 3 Steps 1–6 (Margin, P&L, Take Request, Confirm, Reject/Cancel, Idempotency)
**Status**: ⬜ Not Started
**Depends on**: CP-4 ✅

---

## What Gets Built

### Margin Calculator (`lib/margin.ts`)

- [ ] Formula: `Available Margin = Balance + Worst-Case P&L` (worst-case ≤ 0)
- [ ] Queries: OPEN confirmed trades (user as taker OR maker) + PENDING take requests by user (expires_at > now UTC)
- [ ] EXPIRED requests excluded automatically
- [ ] Groups by contract, generates test points, simulates all possible outcomes
- [ ] **5 mandatory test cases** (must ALL pass before proceeding to trading routes):
  - [ ] Case 1: No trades, no pending → available = full balance
  - [ ] Case 2: One OVER trade, strike 240, size 25 → worst = −25, available = balance − 25
  - [ ] Case 3: OVER trade + PENDING size 50 → worst = −25 + (−50) = −75
  - [ ] Case 4: Two trades same contract, partial hedge → worst ≠ naive sum (example: −20 not −80)
  - [ ] Case 5: Two trades different contracts → worst cases summed independently

### P&L Logic (`lib/pnl.ts`)

- [ ] `calculatePnl(takerSide, strike, settlementValue, size)` → `{ takerPnl, makerPnl }`
- [ ] Binary table from Section 4. Push case = exactly 0 (not null/undefined)

### Take Request API (`POST /api/take-requests`)

- [ ] Self-trade prevention (requester ≠ maker)
- [ ] Quote OPEN + contract OPEN
- [ ] Lazy expiry cleanup: PENDING with `expires_at < now` → EXPIRED
- [ ] Size validation: `>= 1` and `<= quote.size`
- [ ] Margin check for taker. Error: "Insufficient margin: you have X available, this trade requires Y"
- [ ] Create TakeRequest: PENDING, `expires_at = now + 48h (UTC)`
- [ ] Notify maker: "New take request on your quote for contract [title]"
- [ ] Idempotency-Key required

### Confirm API (`POST /api/take-requests/[id]/confirm`)

All-or-nothing Prisma transaction:
- [ ] Verify PENDING + not expired
- [ ] `SELECT FOR UPDATE` on Quote (race condition prevention)
- [ ] Re-run margin for taker (balance may have changed)
- [ ] Re-run margin for maker (opposite side)
- [ ] Strike: OVER → ask, UNDER → bid
- [ ] Create Trade (OPEN)
- [ ] TakeRequest → CONFIRMED
- [ ] Maker inputs new size (pre-fill: `current_size − trade_size`, any value ≥ 0 accepted, 0 = EXHAUSTED)
- [ ] Notify taker
- [ ] Idempotency-Key required

### Reject & Cancel APIs

- [ ] Reject: maker only → REJECTED, notify taker. Idempotency required
- [ ] Cancel: taker only → CANCELLED, margin released. No idempotency

### Idempotency (`lib/idempotency.ts`)

- [ ] Header present → 400 if missing
- [ ] UUIDv7 format → 422 if invalid
- [ ] Dedup by (actorId, action, key)
- [ ] Same key + same hash → cached response
- [ ] Same key + different hash → 422 "Same key, different payload"
- [ ] 24h auto-cleanup

---

## Gate Check — How You Verify

```
1.  Margin test case 1                    → No trades: available = full balance
2.  Margin test case 2                    → OVER trade: available = balance − 25
3.  Margin test case 3                    → OVER + pending: available = balance − 75
4.  Margin test case 4                    → Partial hedge: worst ≠ naive sum
5.  Margin test case 5                    → Different contracts: independent sum
6.  Take request (Ivan on Sam's quote)    → Created, Ivan margin decreases
7.  Take own quote                        → Blocked "cannot take your own quote"
8.  Take as Admin                         → 403
9.  Take request size > quote size        → Error
10. Take request with insufficient margin → Error with available vs required amounts
11. Confirm as Sam                        → Trade created, TakeRequest = CONFIRMED
12. Confirm re-checks taker margin        → Verify in logs
13. Confirm re-checks maker margin        → Verify in logs
14. Cancel pending request                → Margin released immediately
15. Reject request                        → REJECTED, taker notified
16. Duplicate Idempotency-Key             → Cached response, no duplicate created
17. Malformed Idempotency-Key             → HTTP 422
18. Missing Idempotency-Key               → HTTP 400
```

---

## Notes

_Fill in during review:_
- 
