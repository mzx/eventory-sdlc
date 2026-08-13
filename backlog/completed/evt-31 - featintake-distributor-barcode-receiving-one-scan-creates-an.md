---
id: EVT-31
title: 'feat(intake): distributor barcode receiving — one scan creates an attributed part'
status: Done
priority: low
created_date: '2026-08-12 18:33'
updated_date: '2026-08-13 13:23'
assignee: []
labels:
  - parts-logistics
  - intake
  - api
  - web
  - enhancement
dependencies: []
references:
  - research/parts-logistics-at-scale.md
  - apps/web/src/pages/IntakePage.tsx
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Receiving a bag of parts from DigiKey/Mouser/LCSC means typing the part number,
quantity, and description by hand. Distributor labels already carry a 2D code
(Data Matrix / PDF417, ECIA-standard field identifiers) encoding MPN, customer
reference, quantity, and often lot/date code. PartsBox and InvenTree treat
one-scan receiving as their killer feature (research dossier, Mechanics 01) — it is
the highest-leverage receiving pattern that scales down to personal inventory.

## Goal

- Intake flow gains a "Scan supplier barcode" path beside photo capture: decode
  Data Matrix / PDF417 from the camera (evaluate `BarcodeDetector` API with a JS
  fallback library; decoding stays client-side)
- Parse ECIA 2D label fields (ANSI MH10.8.2 data identifiers: P = customer part,
  1P = MPN, Q = quantity, 1T/9D = lot/date) with graceful handling of partial data
- Pre-fill the draft item: name from MPN, quantity from Q, properties JSON gains
  `mpn`, `supplierPn`, `lot`, `dateCode` keys; user reviews and saves through the
  existing intake confirm step (QR sticker, location, photos all unchanged)
- Scanning the same MPN again offers "add to existing item" (records an `add`
  movement per EVT-25 when chosen) instead of silently creating a duplicate

## Non-goals

- Supplier API lookups (pricing, datasheets) — offline parse only
- 1D barcode receiving or arbitrary-format guessing
- Purchase-order tracking

## Risk

- Label formats vary by distributor and era; the parser must degrade to "raw scan
  text in a field, user fills the rest" rather than rejecting the scan.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Intake offers the barcode path; a DigiKey-style ECIA Data Matrix test vector decodes and pre-fills MPN, quantity, and lot into the draft
- [x] Partial labels (missing identifiers) pre-fill what exists and leave the rest editable — no dead ends
- [x] Saved items carry `mpn`/`supplierPn`/`lot`/`dateCode` in properties and appear in search by MPN
- [x] Re-scanning a known MPN offers add-to-existing; choosing it records an `add` movement instead of creating a duplicate item
- [x] Decoding works fully client-side (no image leaves the device for this path)
- [x] Unit tests cover the ECIA field parser (full, partial, malformed vectors); web tests cover the intake wiring; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Added distributor barcode receiving to the intake flow (EVT-31): a client-side ECIA 2D label parser, a Data Matrix/PDF417 scanner dialog, and a new POST /api/items/:id/receive endpoint so re-scanning a known MPN adds to the existing item (recording an EVT-25 `add` movement) instead of creating a duplicate.

## Changes
- `apps/web/src/lib/eciaBarcode.ts` — ECIA / ISO 15434 envelope + ANSI MH10.8.2 DI parser (P, 1P, Q, 1T, 9D), degrades to raw text on malformed scans
- `apps/web/src/lib/eciaBarcode.test.ts` — full/partial/malformed/unrecognized-DI parser vectors
- `apps/web/src/components/BarcodeScannerDialog.tsx` — camera scanner restricted to DATA_MATRIX/PDF_417 via existing @zxing deps (fully client-side)
- `apps/web/src/components/BarcodeScannerDialog.test.tsx` — decode, error, and camera-cleanup lifecycle tests
- `apps/web/src/pages/IntakePage.tsx` — "Scan supplier barcode" path, draft prefill (mpn/supplierPn/lot/dateCode), barcode-match step offering add-to-existing
- `apps/web/src/pages/IntakePage.test.tsx` — AC1–AC4 wiring tests incl. exact-match-not-substring negative test
- `apps/web/src/api.ts` — receiveItem client call
- `apps/api/src/items/receive-item.dto.ts` — bounded-int quantity DTO
- `apps/api/src/items/items.service.ts` — ItemsService.receive() via existing recordMovement path (`kind: 'add'`)
- `apps/api/src/items/items.controller.ts` — POST /api/items/:id/receive (JwtAuthGuard, ParseUUIDPipe)
- `apps/api/src/items/items.controller.spec.ts`, `items.service.spec.ts` — receive endpoint coverage at 100% lines

## Design decisions
- zxing-only decoding (no BarcodeDetector API): inconsistent DataMatrix/PDF417 support across browsers, none in Safari/Firefox — rationale recorded in a doc comment
- Search-by-MPN needed no backend change: existing properties-JSONB ILIKE search already covers it
- Exact (not substring) mpn/supplierPn match against search results before offering add-to-existing

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved (⚠ INDEPENDENCE NOT ENFORCED (codex unavailable, fell back to claude-code))

## Follow-up
- Minor (code review): memoize `onDecoded` passed to BarcodeScannerDialog (fresh arrow each render restarts the decoder via useEffect deps); fix doc-comment inaccuracy in receive-item.dto.ts (@Min(1) vs @Min(0) claim)
- Minor (test review): add tests for the fetchItems lookup-failure fallback and the receive-mutation error alert
- Minor (security review): consider @MaxLength on item name / bound on serialized properties size (barcode is a new untrusted input source); consider a lower @Max or post-increment bound on receive quantity to avoid int4-overflow 500s
