---
id: EVT-31
title: 'feat(intake): distributor barcode receiving — one scan creates an attributed part'
status: To Do
priority: low
created_date: '2026-08-12 18:33'
updated_date: '2026-08-12 18:33'
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
- [ ] Intake offers the barcode path; a DigiKey-style ECIA Data Matrix test vector decodes and pre-fills MPN, quantity, and lot into the draft
- [ ] Partial labels (missing identifiers) pre-fill what exists and leave the rest editable — no dead ends
- [ ] Saved items carry `mpn`/`supplierPn`/`lot`/`dateCode` in properties and appear in search by MPN
- [ ] Re-scanning a known MPN offers add-to-existing; choosing it records an `add` movement instead of creating a duplicate item
- [ ] Decoding works fully client-side (no image leaves the device for this path)
- [ ] Unit tests cover the ECIA field parser (full, partial, malformed vectors); web tests cover the intake wiring; coverage meets the 80% threshold
<!-- AC:END -->
