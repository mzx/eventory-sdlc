---
id: EVT-47
title: 'feat(web,api): workspace settings — rename + delete with confirmation'
status: Done
priority: medium
updated_date: '2026-08-21'
labels:
  - web
  - api
  - tenancy
dependencies: []
references:
  - apps/api/src/workspace/workspaces.controller.ts
  - apps/api/src/workspace/workspaces.service.ts
  - apps/web/src/pages/MembersSettingsPage.tsx
  - apps/web/src/workspace/useActiveWorkspace.ts
  - apps/api/prisma/schema.prisma
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Workspaces can be created, joined, and administered (EVT-42/43), but there is
no way to rename one or get rid of one. Renaming is HALF built: the API ships
`PATCH /api/workspaces/:id` (owner-only) and `renameWorkspace()` already
exists in web `api.ts` — no UI calls it. Deleting does not exist anywhere.

## Goal

Basic workspace lifecycle management, owner-only, in the settings area
(natural home: the EVT-43 `MembersSettingsPage`, or a sibling
`/settings/workspace` page — implementer's choice, keep it simple):

**Rename (web-only — API is done)**
- Inline edit of the workspace name; calls the existing `renameWorkspace()`.
  On success the switcher, app bar, and cached workspace list reflect the new
  name without a reload (invalidate the workspaces cache).

**Delete (API + web)**
- New `DELETE /api/workspaces/:id`, owner-only (same membership-against-path-
  param check the other management routes use — see the `WorkspacesService`
  doc comment on why `:id`, not the request's workspace context).
- Domain tables FK the workspace with `onDelete: Restrict` (deliberate,
  EVT-39), so the service must explicitly delete the workspace's domain rows
  in one `$transaction` in dependency order (stock movements / BOM lines /
  photos / items / tags / categories / locations / projects / shopping-list
  rows, then the workspace row — members + invites cascade via schema).
  After commit, best-effort unlink the workspace's photo files from
  `STORAGE_DIR` (reuse `PhotosService.unlinkQuietly` pattern; DB-first order
  so a crash never leaves rows pointing at deleted files).
- **RLS trap (EVT-44):** the request's DB session context is set from the
  ACTIVE workspace (header), which need not be the `:id` being deleted. The
  cascade must run with DB context pinned to the target workspace (or the
  documented bypass pattern) or RLS silently deletes nothing.
- **The Default Workspace (`00000000-…-0001`) is NOT deletable — 409.** Every
  domain column's schema-level `@default(dbgenerated(...))` points at that
  id (see schema header note); deleting the row would break those defaults,
  and prod's original data lives there.

**Confirmation UX**
- Deleting destroys ALL workspace data for ALL members, so a plain "are you
  sure?" is not enough: MUI dialog stating what will be permanently deleted
  (item/photo counts — fetchable or approximate) and requiring the workspace
  name typed to enable the destructive button (GitHub-style).
- After deleting the ACTIVE workspace the web app must land coherently:
  clear the stored active-workspace id, invalidate the cached list, fall
  back to another membership; deleting the LAST membership lands in the
  existing zero-membership flow (create-or-redeem), not an error loop.

## Non-goals

- Soft-delete / undo / retention (permanent delete is fine for a household
  tool with nightly backups)
- Transferring data between workspaces before delete
- Renaming via API changes — the endpoint is done
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Owner can rename a workspace from settings; switcher/app-bar/cache update without reload; non-owners don't see the affordance (server already 403s)
- [x] `DELETE /api/workspaces/:id` — owner-only; single transaction removes all domain rows in FK order + workspace row; photo files unlinked best-effort after commit
- [x] RLS: deletion works when the caller's active workspace differs from `:id` (e2e or integration evidence)
- [x] Default Workspace delete is refused with 409 + clear message
- [x] Confirmation dialog requires the workspace name typed; shows what will be destroyed; cancel is default-focused
- [x] Deleting the active workspace switches the app to another membership; deleting the last one lands in the zero-membership create-or-redeem flow
- [x] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary
Added owner-only workspace rename + delete to a new "Workspace" section on MembersSettingsPage. Rename wires the existing renameWorkspace() API into an inline edit that invalidates the shared workspaces cache, so the switcher and app bar update without reload. Delete adds DELETE /api/workspaces/:id (owner-only; 409 for the Default Workspace) which removes every domain row in one FK-ordered $transaction pinned to the TARGET workspace via workspaceDbContext.run — closing the EVT-44 RLS trap where the caller's active workspace can differ from the one being deleted — then best-effort unlinks the workspace's photo files after commit. A GitHub-style confirmation dialog requires the exact workspace name typed, shows approximate item/photo counts, and default-focuses Cancel; deleting the active workspace falls back to another membership, and deleting the last one lands in the existing zero-membership create-or-redeem flow.

## Changes
- apps/api/src/workspace/workspaces.controller.ts — new DELETE :id route (owner-only, 204)
- apps/api/src/workspace/workspaces.service.ts — remove(): default-workspace 409 guard, requireOwner, RLS-pinned FK-ordered cascade, post-commit best-effort photo unlink
- apps/api/src/workspace/workspaces.{controller,service}.spec.ts — unit coverage incl. deletion order (invocationCallOrder), 403/404/409, unlink-failure tolerance
- apps/api/test/workspace-deletion.e2e-spec.ts — RLS evidence against the restricted eventory_rls role: deletes workspace A while workspace B is the caller's active workspace
- apps/web/src/api.ts — deleteWorkspace()
- apps/web/src/pages/MembersSettingsPage.tsx(+test) — Workspace section: inline rename, typed-name delete dialog, post-delete fallback
- apps/web/src/test/queryKeyAssertions.ts — documented exemption for the workspace-independent ['workspaces','mine'] key

## Design decisions
- Kept rename/delete on MembersSettingsPage (task allowed implementer's choice) — no new route/nav wiring
- Photo count in the dialog is a deliberate under-count (primary photos via existing GET /api/items) per the "fetchable or approximate" allowance
- DB-first delete order; file unlink strictly after commit so a crash never leaves rows pointing at deleted files

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- coverage — passed (api gate green, workspaces.service.ts 100%; web MembersSettingsPage 95.8% stmts)
- 3 parallel reviews approved, 0 critical / 0 major (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, all reviewers Claude-native)
- Post-rebase onto EVT-46 (shared e2e harness changed): workspace-deletion e2e re-run green on rebased HEAD

## Follow-up
Reviewer minors worth a later pass: (1) wrap assertWorkspaceFullyGone reads in workspaceDbContext.run — unwrapped RLS-scoped reads return [] unconditionally (currently backstopped by Restrict FKs); (2) re-assert requireOwner inside the delete transaction (TOCTOU hardening, EVT-42 pattern); (3) path.basename containment on photo unlink; (4) assert the photo-count half of the destruction preview; (5) integration test for the post-delete fallback wiring.
<!-- SECTION:FINAL_SUMMARY:END -->
