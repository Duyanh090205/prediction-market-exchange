# CP-6: Notifications + Gate Check Day 3

**Covers**: Day 3 Step 7 (Notifications Panel)
**Status**: ⬜ Not Started
**Depends on**: CP-5 ✅

---

## What Gets Built

- [ ] `GET /api/notifications` — returns unread count + recent notifications for current user
- [ ] `PATCH /api/notifications/read` — marks all notifications as read for current user
- [ ] `NotificationPanel` component in navigation bar:
  - [ ] Polls every 5 seconds
  - [ ] Badge with unread count
  - [ ] Dropdown on click
- [ ] Inside dropdown:
  - [ ] Quote owners see incoming take requests with **inline Confirm and Reject buttons** — calls endpoints without leaving page
  - [ ] Traders see confirmation messages, rejection messages, settlement results
  - [ ] Opening the panel calls `PATCH /api/notifications/read` to mark all as read

---

## Gate Check — Full Day 3 Verification

```
1.  Submit take request as Ivan             → TakeRequest created
2.  Ivan's available margin                 → Decreases immediately
3.  Sam's notification panel                → Badge shows 1 unread, dropdown shows "New take request on your quote for contract [title]"
4.  Sam clicks Confirm (inline)             → Trade created, TakeRequest = CONFIRMED
5.  Ivan's notification panel               → "Your take request was confirmed — trade created on contract [title]"
6.  Trade appears in both users' positions  → Correct side, strike, size
7.  Ivan submits another take request       → Created successfully
8.  Ivan cancels that pending request       → Margin released immediately
9.  Margin enforced at submission           → Insufficient margin → error with available vs required
10. Margin enforced at confirmation         → If balance changed since submission → transaction rolls back
11. Sam clicks Reject (inline)              → Request REJECTED, Ivan notified
12. Opening notification panel              → All notifications marked as read
```

---

## Notes

_Fill in during review:_
- 
