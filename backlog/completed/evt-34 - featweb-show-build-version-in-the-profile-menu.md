---
id: EVT-34
title: 'feat(web): show build version in the profile menu'
status: Done
priority: low
created_date: '2026-08-14 10:02'
updated_date: '2026-08-14 10:18'
assignee: []
labels:
  - web
  - enhancement
  - dx
dependencies: []
references:
  - deploy.sh
  - apps/web/vite.config.ts
  - docker-compose.prod.yml
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

There is no way to tell which build is running — locally or on the Vultr VM.
After a deploy, "did the new version actually land?" requires SSHing into the
VM and inspecting git/image metadata. With deploys now routine (deploy.sh) and
a real user on the app, the running version should be visible in the UI.

## Goal

Show the build version in the profile/account menu (the avatar menu in the app
shell that holds the signed-in user's info/logout):

- A small, non-interactive menu entry showing the short commit SHA and build
  date, e.g. `994831b · 2026-08-14`
- Populated at build time (e.g. a Vite `define` constant fed by an env var or
  generated file) — NOT fetched at runtime from git
- Dev builds (vite dev server / dev compose) show a clear `dev` marker instead
  of a fake or missing version

## Constraint worth knowing

`deploy.sh` ships a `git archive` tarball — the remote Docker build has NO
`.git` directory, so the build cannot ask git for the SHA. Two workable
mechanisms (implementer's choice):
1. `.gitattributes` `export-subst` — a `VERSION` file containing
   `$Format:%h %cs$` that `git archive` substitutes at packaging time
2. `deploy.sh` writes the SHA to a file / passes a build arg before upload,
   threaded through docker-compose.prod.yml as a build arg

Whichever is chosen must also degrade gracefully for the dev bind-mount flow
(no tarball, .git present but possibly not accessible in-container → `dev`
marker is fine).

## Non-goals

- An `/api/version` endpoint or api-side version display (follow-up if wanted)
- Semantic versioning / changelogs — the commit SHA is the version
- Update notifications or version-mismatch detection

## Risk

- Touches docker build inputs — a wrong build-arg wiring can silently show a
  stale version, which is worse than none; the prod AC below guards this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] The profile/avatar menu shows a non-interactive version entry with short commit SHA and build date
- [x] The value is injected at build time (Vite define or equivalent); no runtime git or network call
- [x] The mechanism works in the `deploy.sh` flow (git-archive tarball, no `.git` on the VM) — verified by inspecting the built bundle or a deploy to a throwaway target, with evidence in the PR
- [x] Dev builds (vite dev / dev compose) show a `dev` marker instead of a missing or fabricated version
- [x] Web tests cover the menu entry rendering for both a real version and the dev marker; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Build version (short SHA · build date) in the profile/avatar menu, injected at build time via a root `VERSION` file with `$Format:%h %cs$` substituted by `git archive` (`.gitattributes export-subst`) — exactly deploy.sh's packaging step, so prod gets the real version with no `.git` on the VM; every other build path falls back to a `dev` marker. Vite bakes it as a `__BUILD_VERSION__` define; `Dockerfile.caddy` copies VERSION into the build stage only.

## Verification
- `pnpm verify` — all four gates passed; web coverage 89.6% (parser module 100%)
- AC-3 proven empirically: real docker build from a git-archive-extracted tree (no `.git`), bundle grep found the literal `c66db43 · 2026-08-14`; local build bakes `dev`
- Reviews: 3/3 approved in one iteration (code ✅ 1 minor, test ✅ 1 minor + 1 suggestion, security ✅ 1 suggestion); ⚠ INDEPENDENCE NOT ENFORCED (codex unavailable, Claude-native reviewers)

## Follow-up (documented, non-blocking)
- Anchor `.gitattributes` pattern as `/VERSION export-subst` (currently matches any file named VERSION at any depth; harmless today)
- Parser boundary tests (6-char sha, whitespace-only)
- Accepted: SHA+date readable in the unauthenticated public bundle (inherent to build-time defines; drop the date if the fingerprint ever matters)
