---
id: EVT-27
title: 'feat(logistics): count cadence + opportunistic verification — keep records true'
status: Done
priority: medium
created_date: '2026-08-12 18:32'
updated_date: '2026-08-13 13:55'
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
- [x] Migration adds `lastVerifiedAt` and `countIntervalDays`; both editable from the item form
- [x] Counting an item blind-first (no book quantity visible before entry) records an `adjust` movement only when the count differs, and always updates `lastVerifiedAt`
- [x] Verification page lists overdue items most-overdue first, capped at 20, with days-overdue shown; items without an interval never appear
- [x] Consume flow leaving quantity ≤ max(min, 2) offers the inline "how many left?" prompt; skipping is one tap and leaves no state behind
- [x] Scan landing shows "Verify count" when overdue and hides it otherwise
- [x] API + web tests cover blind-count delta math, overdue query ordering, and the opportunistic trigger; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Count cadence + opportunistic verification: `Item.lastVerifiedAt`/`countIntervalDays`, blind-count flow (adjust movement only on difference, lastVerifiedAt always stamped), verification page (most-overdue first, cap 20, nav badge), opportunistic "how many are actually left?" prompt when a consume leaves quantity ≤ max(min, 2), scan-landing "Verify count" affordance, plus a `consume`/"Use" action wired through `recordConsumption`.

## Review history
- Own session: 2 rounds (round 2: consume null-return handling + DTO bounds), approved; aborted cleanly at Step 10.5 on rebase conflicts vs merged EVT-29/EVT-31
- Orchestrator: conflict-resolver rebased (2 mechanical unions: schema.prisma doc header, items.controller.spec mock), all gates green
- Post-rebase re-review (3 reviewers): test ✅ (full suites executed, 605 API + 243 web), security ✅ (1 accepted minor: count-vs-count race, same shape as the accepted PATCH-path race, documented), code ❌ 1 major — **cross-feature bug only visible post-rebase**: `recordConsumption` bypassed the EVT-26 low-stock trigger honored by every other write path
- Fix round (e62451d): low-stock entry now opens with identical threshold/idempotency semantics via a same-transaction re-read after the race-safe decrement; verification-queue invalidation added to item-detail counts; final code review ✅ with executed-test verification

## Verification
- `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm format:check` — all passed at final head
- Final verdicts: code ✅ (1 suggestion), test ✅ (2 suggestions), security ✅ (1 accepted minor, 2 suggestions)

## Follow-up
- Count-vs-count concurrency race (accepted shape, documented in-code) — close with a conditional update if it ever bites
- `listVerificationQueue` does an unbounded scan + app-side filter; SQL-side due-date filter + take would remove the self-DoS surface
- `@IsISO8601` still admits ISO week/ordinal forms → unhandled 500; add a datetime-subset @Matches
- Surface `consumedQuantity` in the web UI ("used 3 of 5") + test
