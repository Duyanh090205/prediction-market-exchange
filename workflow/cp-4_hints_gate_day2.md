# CP-4: Hints + Gate Check Day 2

**Covers**: Day 2 Step 4
**Status**: ✅ Done
**Depends on**: CP-3 ✅

---

## What Gets Built

- [x] `POST /api/hints` — LIQUIDITY_PROVIDER and ADMIN only
- [x] `PATCH /api/hints/[id]` — author only (the user who created it)
- [x] `DELETE /api/hints/[id]` — author only
- [x] Each hint: text content + optional URL + optional display label
- [x] URL without label → URL itself used as link text
- [x] Links always open in new tab (`target="_blank"`)
- [x] `HintPanel` component displays hints newest-first on market page left column

---

## Gate Check — Full Day 2 Verification

```
1.  Sam's quote in left column            → Large and visually prominent ✅
2.  Other quotes in right column           → Smaller list format ✅
3.  POST quote with bid >= ask             → Validation error, nothing saved
4.  POST hint as Sam (LP)                  → Created successfully
5.  POST hint as Admin                     → Created successfully
6.  POST hint as Ivan (USER)               → 403 Forbidden
7.  Hint with URL + label                  → Clickable label text, opens new tab
8.  Hint with URL, no label                → URL itself shown as link text, opens new tab
9.  Hint without URL                       → Plain text displayed, no link
10. Hints ordered newest-first             → Most recent hint at top of HintPanel
11. Edit hint as author                    → Updated successfully
12. Delete hint as author                  → Removed from HintPanel
13. Edit hint as non-author                → Rejected
```

---

## Notes

_Fill in during review:_
- 
