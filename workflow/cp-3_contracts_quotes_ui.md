# CP-3: Contract & Quote APIs + Market UI

**Covers**: Day 2 Steps 1–3
**Status**: ⬜ Not Started
**Depends on**: CP-2 ✅

---

## What Gets Built

### APIs

- [ ] `GET /api/contracts` — all OPEN contracts. Each includes quotes + maker role (so UI detects LIQUIDITY_PROVIDER)
- [ ] `POST /api/contracts` — Admin only (role check first, 403 if not). Title + description
- [ ] `GET /api/contracts/[id]` — full detail: all quotes (with maker roles), all hints (newest first), all confirmed OPEN trades
- [ ] `POST /api/quotes` — USER or LIQUIDITY_PROVIDER only. Admin blocked (403). Validate: `bid < ask`, `size >= 1` (integer, no decimals)
- [ ] `PATCH /api/quotes/[id]` — maker only. Blocked if PENDING take requests exist → "Resolve all pending requests before editing." Otherwise update bid/ask/size
- [ ] `DELETE /api/quotes/[id]` — maker only. Transaction: all PENDING requests → REJECTED, notify each requester, quote → CANCELLED

### UI Pages

- [ ] `app/page.tsx` — landing page listing all open contracts. Dark mode trading platform aesthetic
- [ ] `app/markets/[id]/page.tsx` — two-column market layout:
  - **Left column**: Sam's quote (large, prominent — detected by `quote.maker.role === 'LIQUIDITY_PROVIDER'`). Below: take request form + HintPanel
  - **Right column**: other players' quotes (smaller list, with maker name, bid/ask/size, take action if not maker)
  - **Below both**: all confirmed trades on this contract
- [ ] Components: `ContractCard`, `QuoteCard` (prominent variant for LP), `TakeRequestForm`

---

## Gate Check — How You Verify

```
1.  POST /api/contracts (as Admin)       → Contract created successfully
2.  POST /api/contracts (as Sam)         → 403 Forbidden
3.  POST /api/contracts (as Ivan)        → 403 Forbidden
4.  POST /api/quotes (as Sam)            → Quote created
5.  POST /api/quotes (as Admin)          → 403 Forbidden
6.  POST /api/quotes bid=250, ask=200    → Validation error "bid must be < ask"
7.  POST /api/quotes bid=200, ask=200    → Validation error (bid must be strictly < ask)
8.  POST /api/quotes size=0              → Validation error "size must be >= 1"
9.  Navigate to /markets/[id]            → Two-column layout renders
10. Sam's quote                          → Displayed large on left column
11. Other player's quote                 → Displayed in right column list
12. Landing page /                       → Shows all open contracts
```

---

## Notes

_Fill in during review:_
- 
