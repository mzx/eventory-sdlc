---
id: EVT-34
title: 'feat(web): show build version in the profile menu'
status: To Do
priority: low
created_date: '2026-08-14 10:02'
updated_date: '2026-08-14 10:02'
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
- [ ] The profile/avatar menu shows a non-interactive version entry with short commit SHA and build date
- [ ] The value is injected at build time (Vite define or equivalent); no runtime git or network call
- [ ] The mechanism works in the `deploy.sh` flow (git-archive tarball, no `.git` on the VM) — verified by inspecting the built bundle or a deploy to a throwaway target, with evidence in the PR
- [ ] Dev builds (vite dev / dev compose) show a `dev` marker instead of a missing or fabricated version
- [ ] Web tests cover the menu entry rendering for both a real version and the dev marker; coverage meets the 80% threshold
<!-- AC:END -->
