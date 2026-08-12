---
id: EVT-27
title: 'feat(logistics): count cadence + opportunistic verification — keep records true'
status: To Do
priority: medium
created_date: '2026-08-12 18:32'
updated_date: '2026-08-12 18:32'
assignee: []
labels:
  - parts-logistics
  - api
  - web
  - enhancement
dependencies:
  - EVT-25
references:
  - research/parts-logistics-at-scale.md
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Inventory data drifts from reality and there is no mechanism to notice. The
professional discipline (research dossier, Mechanics 05) is cheap, scheduled,
opportunistic counting — not annual wall-to-wall sessions: count each thing on an
interval, and grab free counts at the moment stock runs low ("how many are actually
left?" takes two seconds when the answer is small).

## Goal

- `Item.lastVerifiedAt DateTime?` and `Item.countIntervalDays Int?` (null = not on a
  count schedule)
- Any explicit count sets `lastVerifiedAt` and records an `adjust` movement when the
  entered count differs from book quantity (delta = counted − book)
- Verification list page: items whose `lastVerifiedAt + countIntervalDays` is past
  due, most-overdue first, capped at 20 — "today's count list"
- Blind entry: the count dialog asks "How many are there?" WITHOUT pre-filling the
  book quantity; the book value and computed delta are revealed after entry
- Opportunistic prompt: when a consume movement leaves quantity ≤ max(minQuantity, 2),
  the confirmation UI offers "how many are actually left?" inline — answering counts
  the item, skipping is one tap
- Scan-landing page for an item shows a "Verify count" affordance when the item is
  overdue

## Non-goals

- Per-location count scheduling (items only, matching the current one-location model)
- Tolerance tiers / approval workflows (single-user app)
- Any change to how quantity is stored

## Risk

- Prompt fatigue: the opportunistic prompt must be skippable in one tap and never
  block the flow it rides on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Migration adds `lastVerifiedAt` and `countIntervalDays`; both editable from the item form
- [ ] Counting an item blind-first (no book quantity visible before entry) records an `adjust` movement only when the count differs, and always updates `lastVerifiedAt`
- [ ] Verification page lists overdue items most-overdue first, capped at 20, with days-overdue shown; items without an interval never appear
- [ ] Consume flow leaving quantity ≤ max(min, 2) offers the inline "how many left?" prompt; skipping is one tap and leaves no state behind
- [ ] Scan landing shows "Verify count" when overdue and hides it otherwise
- [ ] API + web tests cover blind-count delta math, overdue query ordering, and the opportunistic trigger; coverage meets the 80% threshold
<!-- AC:END -->
