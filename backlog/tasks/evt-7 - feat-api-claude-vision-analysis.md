---
id: EVT-7
title: 'feat(api): Claude vision analysis on upload — structured draft JSON, prompt caching, stub without key'
status: To Do
labels: [api, ai, photos]
dependencies: [EVT-6]
references: [PRODUCT.md]
priority: high
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
- [ ] Unit tests with mocked Anthropic client: happy path parse, fenced-JSON parse, malformed → stub fallback, no-key → stub without constructing client
- [ ] Upload with `?analyze=true` persists `aiAnalysis` and returns it; without the flag stays null
- [ ] Anthropic client is never instantiated at module init when key is absent (app boots cleanly)
- [ ] System prompt block carries `cache_control: ephemeral`
<!-- AC:END -->
