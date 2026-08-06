---
id: EVT-7
title: 'feat(api): Claude vision analysis on upload — structured draft JSON, prompt caching, stub without key'
status: Done
labels: [api, ai, photos]
dependencies: [EVT-6]
references: [PRODUCT.md]
priority: high
updated_date: '2026-08-06 13:02'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Manual item entry is the friction the app exists to remove. A photo should produce a draft item record.

## Goal

`AiModule` with an `AiService.analyzePhoto(buffer, mimeType)`:

- Uses `@anthropic-ai/sdk`. Model from env `EVENTORY_ANTHROPIC_MODEL`, default `claude-sonnet-5`;
  key from `EVENTORY_ANTHROPIC_KEY`.
- System prompt (marked with `cache_control: { type: 'ephemeral' }` for prompt caching)
  instructs: identify the workshop/household item and return ONLY JSON:
  `{ suggested_name, description, tags[], color, quantity, unit, properties{}, search_keywords[] }`.
  Properties = concrete attributes it is CONFIDENT about (brand, size, voltage…);
  uncertain specs go to `search_keywords`, never stated as fact.
- Image sent as base64 content block; response parsed defensively (strip code fences,
  tolerate malformed JSON → fall back to stub shape).
- **No key configured → deterministic stub** (`suggested_name: 'Unknown item'`, empty
  arrays) so the app runs fully offline; log a one-line notice.
- Wire into `POST /api/photos/upload?analyze=true` (EVT-6): run analysis, persist raw
  result to `Photo.aiAnalysis`, return it in the response.
- AI output is a DRAFT for the intake form. Nothing is auto-created from it (decision log).

## Non-goals

- Visual similarity search (EVT-17), re-analysis endpoint, batching, streaming
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Unit tests with mocked Anthropic client: happy path parse, fenced-JSON parse, malformed → stub fallback, no-key → stub without constructing client
- [x] Upload with `?analyze=true` persists `aiAnalysis` and returns it; without the flag stays null
- [x] Anthropic client is never instantiated at module init when key is absent (app boots cleanly)
- [x] System prompt block carries `cache_control: ephemeral`
<!-- AC:END -->

## Final Summary

## Summary
AiModule/AiService.analyzePhoto: Claude vision via @anthropic-ai/sdk (model env EVENTORY_ANTHROPIC_MODEL, default claude-sonnet-5; key EVENTORY_ANTHROPIC_KEY), lazily-constructed client (rebuilds on key change), cache_control ephemeral system prompt, base64 image block, defensive parse (fence-strip, per-field coercion, refusal/malformed → stub). No key → deterministic stub, client never constructed at boot. Wired into POST /api/photos/upload?analyze=true persisting Photo.aiAnalysis. Round 2 added @nestjs/throttler (global + strict upload limit), jpeg/png/gif/webp vision allowlist with stub_reason 'unsupported-image-format', 5MB pre-encode ceiling (stub_reason 'oversized'), and itemId pre-validation before the billed call.

## Changes
- apps/api/src/ai/{ai.module,ai.service,ai.service.spec}.ts — vision analysis service + 20+ tests
- apps/api/src/photos/* — analyze flag wiring, throttled controller, size/FK guards
- apps/api/src/common/throttle.config{,.spec}.ts — env-tunable throttle config
- apps/api/src/app.module.ts, package.json, pnpm-lock.yaml — module + deps

## Verification
- pnpm build/test/lint/format:check — all passed (209 unit + 26 e2e tests)
- Reviews: 2 rounds. R1: 2 major (unthrottled billed endpoint; HEIC silent stub) → fixed. R2: code-reviewer ✓, security-reviewer ✓ (classifier @ 0.9, testing auto-approved) — ⚠ codex unavailable, claude-native fallback

## Follow-up
Minor deferred: throttle env overrides read before dotenv (.env values ignored — use real env vars); trust-proxy/multi-replica throttler notes for deploy; unsupported-mime path still reads file from disk needlessly.
