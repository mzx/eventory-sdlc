# Parts Logistics at Scale

**How enterprises running mass-production assembly identify, store, feed, count, and trace parts — the tool landscape from SAP to maker-tier, and what Eventory can steal from it.**

| | |
|---|---|
| **Date** | 2026-08-12 |
| **Method** | 10 research agents · 6 angles + completeness critic + 3 gap-fills |
| **Coverage** | ~50 tools · ~60 practices · 70+ sources |
| **Published artifact** | https://claude.ai/code/artifact/7e9bc8dd-dadb-4ab5-aa2d-fb51e98e0d0f |

---

## The short version

- **Factories scan containers, not parts.** Every tote, pallet, and reel carries its own serialized "license plate"; contents are a database lookup. Identity lives on the container, and one scan books an entire pallet.
- **Physical flow and book flow are deliberately separated.** Parts move fast and paperlessly (a bin scanned "empty" is not a goods issue); the ledger catches up later by *backflushing* — exploding the BOM when a finished unit is confirmed.
- **No plant feeds all parts the same way.** Each part number is assigned one of four supply strategies — two-bin kanban, boxed batch supply, per-unit kitting, or just-in-sequence delivery — based on size, variant count, and consumption rate.
- **Replenishment is a physical gesture, not a report.** Toss the empty bin in an RFID chute, let the weight sensor cross a threshold, scan the kanban card — one action fires the resupply. Nobody reads a dashboard to reorder screws.
- **The numbers in the min/max fields are computed, not typed.** A whole software tier (LeanDNA, ToolsGroup, SAP IBP) exists just to calculate safety stocks and loop sizes from demand history and write them back into the ERP, which executes them blindly.
- **Counting is opportunistic and tolerance-gated.** The best counts happen when a pick leaves 1–2 units in a bin ("how many are left?" takes two seconds); variances pass through auto-recount → analyst review → auto-post gates. Blind counts, or the metric measures compliance instead of reality.
- **The factory boundary is crossed by data before goods.** The supplier's ASN describes the exact pallet tree before the truck arrives; receiving is a scan-vs-manifest diff, and under consignment nobody ever sends an invoice — the assembly line's takt is the payment trigger.
- **Eventory's QR-label habit is exactly right.** From SAP EWM down to Odoo, the scan *is* the transaction. The professional upgrade is giving each scan a typed meaning against a document (task, order, control cycle), not just updating a quantity.

---

## The stack: who owns what

Enterprise parts logistics is not one system. It is a strict layer cake with **one authority per fact**: PLM owns what a part *is*, a planning tier computes the parameters, ERP owns quantities and money, WMS owns physical execution, MES owns what actually got built. Sync between layers is release-gated. Mixing these authorities is, per multiple sources, the root cause of most parts-data corruption.

| Layer | Owns | What happens there | Representative products |
|---|---|---|---|
| **PLM / BOM governance** | Part identity · structure · change | Engineering BOM and manufacturing BOM are deliberately *different structures* kept provably linked; changes travel as ECOs with serial/date effectivity; every purchased part carries an approved-manufacturer list (AML) buyers must source against. | Siemens Teamcenter, PTC Windchill, Aras, Arena, Duro, OpenBOM |
| **Planning & optimization** | The parameters | Reads ERP history, computes safety stocks, reorder points, kanban loop sizes and per-part policies (ABC/XYZ), predicts shortages per buildable assembly, writes the numbers back into ERP master data on a nightly-to-monthly cadence. | LeanDNA, ToolsGroup SO99+, SAP IBP, GAINS, Baxter Planning |
| **ERP / MRP** | Quantities · money · demand | Explodes BOMs into time-phased orders with pegging back to customer demand; runs kanban control cycles and min/max rules; posts consumption by backflush; settles consignment. Deliberately dumb about its own parameters. | SAP S/4HANA, Dynamics 365 SCM, Oracle Fusion, Infor, Epicor, Plex, Odoo, MRPeasy, Katana |
| **WMS / intralogistics** | Bins · movements · people & robots | Typed bin hierarchy with strategy-bearing nodes; every movement is a scan-confirmed task with source, destination, and audit trail; directed putaway and picking; line-feeding via production supply areas, supermarkets, milk-run trains, VLMs, AutoStore, AMRs. | SAP EWM, Manhattan Active, Blue Yonder, Körber, Kardex/Modula, AutoStore, Locus, MiR |
| **MES / traceability** | As-built genealogy | Verifies the right reel is on the right feeder before the machine will run; records which lot went into which serial number; answers recall queries in both directions in minutes. | Siemens Opcenter, Aegis FactoryLogix, Cogiscan, Plex MES |
| **Supplier network** (the boundary) | The boundary crossing | No purchase orders in series production — one scheduling agreement per part+supplier, demand streamed as forecast (DELFOR) + JIT call-off (DELJIT), goods announced by ASN, received by one label scan, reconciled as cumulative totals, often paid on consumption via self-billing. | SupplyOn, SAP Business Network, SEEBURGER/EDICOM, Odette GTL labels |

---

## The tool market, by tier

The same concepts repeat at every price point — what changes is ceremony and integration depth. The bottom tier is the most instructive for Eventory: it shows which enterprise ideas survive being scaled down.

| Tier | Representative tools | What they teach |
|---|---|---|
| **Fortune 500** | SAP S/4HANA (PP/MM/EWM), Dynamics 365 SCM, Oracle Fusion SCM, Teamcenter, Windchill, Manhattan, Blue Yonder | The reference mechanics: production supply areas + kanban control cycles + backflush; directed putaway; eBOM→mBOM transformation; handling-unit indirection. SAP's kanban is literally a state machine (EMPTY/FULL/IN TRANSIT) on container records. |
| **Automotive vertical** | Plex, QAD, Royal 4 WISE (sequencing), Cogiscan (SMT), SupplyOn | Compliance is inseparable from logistics: an e-kanban signal is legally a supply-contract release; every container is serialized at the point of production; sequence racks are error-proofed per vehicle. Plex shows the alternative to backflush — make scanning so cheap you record real consumption. |
| **Mid-market** | Infor CloudSuite Industrial, Epicor Kinetic, NetSuite, Aegis FactoryLogix, Essegi/Mycronic towers, Kardex VLMs | Automotive-grade lot/serial traceability without the SAP project; smart storage where the machine owns the location; delta-kitting pull replenishment. |
| **SMB** | Odoo, MRPeasy, Katana, Aligni, Fulcrum | The minimum viable professional feature set: available-to-promise math + BOM auto-deduction on build completion + reorder points per location. Odoo's reordering rules are a complete, readable, open-source spec of min/max replenishment. |
| **Maker / small shop** | PartsBox, InvenTree, Bomist, OpenBOM | Closest cousins to Eventory. InvenTree's Part-vs-Stock-Item split and location tree are the data model a personal app converges toward; PartsBox's distributor-barcode receiving (one DataMatrix scan creates a fully-attributed lot) is the killer scaled-down pattern. |
| **VMI / smart-bin hardware** | Würth CPS (iBin camera bins), Bossard SmartBin (weight), Fastenal FASTBin, eTurns TrackStock | For C-parts (fasteners), the supplier owns the loop entirely: bins that watch themselves via camera, weight, or RFID-on-empty, firing replenishment with zero human workflow. A $20 load cell + ESP32 replicates the concept. |

---

## Mechanics 01 — Identity: the license-plate principle

The core mechanic everything else builds on is **indirection**. Labels carry only a serialized ID; contents, lot, quantity and location are database lookups. Enterprises rarely scan parts — they scan *containers*: SAP calls them handling units, other WMSs call them license plates (LPN), electronics lines serialize every reel.

Why it matters, in one example from a published lean-kitting study: an ERP that knows "20,000 resistors" but not "four reels of 5,000, each with its own barcode and history" *cannot kit* a part split across two feeder modules — and the line stops. Package-level identity is what makes kitting, FIFO, and traceability possible at all.

- **Identifier classes stay separate** (the GS1 discipline): a product-type ID (GTIN-like), an instance ID (lot/serial), a location ID (GLN-like), a container ID (SSCC). "Where" is never encoded into "what" — location is always a transaction linking two identifiers.
- **Symbology has settled:** Data Matrix ECC 200 for anything small or marked directly on metal (25–100× denser than 1D, reads at low contrast, graded at creation so bad codes never ship); QR where a human with a phone is the scanner; Code 128 lingers on transport labels.
- **RFID is for containers, not parts:** UHF tags on returnable racks/totes with reader gates at dock doors (>99.5% reads, 92% less manual reconciliation at one pool operator). Cheap individual parts stay on printed 2D codes.
- **Regulation is converging on serialized QR:** the EU Digital Product Passport registry went live July 2026; battery passports become mandatory Feb 2027, anchored to physical units by QR codes with ISO/IEC 15459 identifiers. GS1 "Sunrise 2027" moves retail POS to 2D codes. A *GS1 Digital Link* — the identifier encoded as an HTTPS URI in a QR — serves phone, scanner, and web page with one code.

> **Transferable:** Eventory's QR labels already implement the primitive. The upgrade path is (a) separate label classes for items, boxes, and locations, and (b) encoding labels as Digital-Link-style URLs so any phone camera resolves them without the app installed.

---

## Mechanics 02 — Feeding the line: four strategies, chosen per part

The defining discipline of mass-production parts logistics is that **every part number gets an explicit supply strategy** — the decision keys are size, variant count, consumption rate, and lineside space:

| Strategy | For | How it works |
|---|---|---|
| **Two-bin kanban** | Cheap commodity parts (screws, clips) | Two bins at the point of use; emptying bin 1 *is* the reorder signal while bin 2 covers the lead time. No order reference at all — the loop is a state machine on the container (EMPTY → replenishment fires → FULL). |
| **Boxed / batch supply** | Medium-variety parts | Full containers staged to the line per aggregated demand ("release order parts" in SAP), replenished from the warehouse on pull. |
| **Kitting** | Complex stations, high variety | One container holds exactly the parts for one unit, picked in a supermarket, traveling with or meeting the product. The value is in the error-proofing: kit release gated on full availability, pick-to-light lanes, paired scans "marrying" part to slot. |
| **Just-in-sequence (JIS)** | Bulky, high-variant parts (seats, dashboards) | Not stocked at all. The OEM freezes the build order ("pearl chain") when a body exits paint, broadcasts a per-vehicle EDI call-off, and the supplier delivers racks loaded in exact build order within a 4–8 hour window. Rack position N *is* the part identification. A sequence break stops a line burning €5–15K per minute. |

### The supporting cast

- **PFEP (Plan For Every Part)** — the master table the whole discipline hangs off: per part, its usage rate, container type and dimensions, parts-per-container, point-of-use location, supplier, lead time. Supermarket rack sizes, kanban card counts, and delivery routes are all *derived* from it. Lean Enterprise Institute calls it "the DNA of your plant."
- **Supermarket + milk-run** — a small decoupling store near the line with one addressed lane per part; a tugger train (increasingly an autonomous robot) circulates on a fixed timetable like a bus route, dropping full containers and collecting empties and kanban signals. The **water spider** is the dedicated human running this loop so assemblers never leave their station.
- **Smart-bin VMI for C-parts** — for fasteners, the transaction cost of a PO exceeds the part's value, so the distributor owns the loop with self-watching bins: Würth's iBin has a camera *inside the bin* rating fill level; Bossard puts weight sensors under every bin; Fastenal and eTurns use RFID-on-empty. The plant never counts or orders these parts again.
- **Auto-tuned loops** — the thing that kills paper kanban is stale card counts. Modern e-kanban (Synchrono SyncKanban, eTurns min/max tuning) recomputes loop sizes continuously from live consumption.

> **Transferable:** One `replenishment policy` field per item+location (none / min-max / two-bin) plus a one-tap "bin empty" action on a scanned QR that appends to a shopping list is the honest scaled-down version of all of this. A uniform "stock everything in bins" model is exactly what professionals design away from.

---

## Mechanics 03 — Consumption accounting: backflush vs. scan-everything

Two philosophies exist for keeping the books honest while parts move fast:

- **Backflush (post-deduct):** record nothing when parts move to the line; when a finished unit is confirmed, explode its BOM and post all component issues automatically from the lineside location. SAP is explicit that "setting a kanban to empty is not a goods issue." Failed postings queue for cleanup (COGI); periodic counts catch drift. Dynamics 365 goes further in lean mode: consumption is declared when a handling unit is registered empty, and WIP is financially reconciled *per production flow per period*, not per order.
- **Scan-everything (Plex model):** serialize every container at the point of production and make every move a barcode scan — lot genealogy is captured as a side effect of shop-floor execution. Works when the scan is cheaper than the inventory error it prevents.

Katana's "auto-deduct BOM on order completion" is the same backflush idea at maker price. The professional insight either way: **the movement ledger, not the stock snapshot, is the primary data structure** — on-hand quantity is a projection of transactions.

> **Transferable:** For Eventory's BOM projects: deduct component stock when a build is marked done (backflush), and record *which specific lots* the build consumed — genealogy for free (see Mechanics 06).

---

## Mechanics 04 — Crossing the factory boundary

How parts move between companies is its own discipline, and it abandons purchase orders entirely:

- **Scheduling agreements, not POs:** one long-running contract per part+supplier. Demand streams across it as two overlapping messages — `DELFOR`/EDI 830 forecasts months out (planning authorization) and `DELJIT`/EDI 862 firm call-offs in day/hour granularity (shipping authorization), with contractual firm zones defining who eats cancelled demand.
- **Position tracked as cumulative totals:** neither side reconciles order lines. The customer transmits "cumulative received = 148,200 this year"; the supplier compares against cumulative shipped; the delta ships. Self-healing against lost messages — but so load-bearing that a whole product (WSW SPEEDI) exists just to re-base CUMs when the two companies' fiscal years reset on different dates.
- **ASN before truck, one-scan receiving:** at truck departure the supplier sends the despatch advice (`DESADV`/EDI 856) carrying the full nested pallet→carton tree keyed by globally unique package license plates. The plant's WMS pre-builds the expected delivery; the dock worker scans *one* barcode on the Odette GTL master label and the entire pallet posts as received. Bosch's guideline states it flatly: label and ASN "must contain the same information" — the label is the physical index into the electronic manifest. Receiving becomes reconciliation, not data entry.
- **The long tail rides a portal:** SupplyOn and SAP Business Network give a 5-person machine shop a browser UI that emits the same standard ASN and prints the same compliant label as a global tier-1 — the plant's receiving automation can't tell the difference.
- **Money follows consumption:** under consignment, supplier-owned stock sits in the plant unvalued; ownership transfers when production backflush withdraws it, and a periodic settlement run (SAP `MRKO`) self-bills the supplier. *No invoice exists anywhere in the loop.*

> **Transferable:** "Label = key into a pre-declared manifest" scales down: when moving a box of items between locations, generate a manifest, put one QR on the box, and receive by diffing scan against manifest.

---

## Mechanics 05 — Keeping records true: counting as a state machine

Counting is "the weakest link everywhere," and the professional response is a disciplined pipeline, not more counting: *scheduled/triggered → counted → tolerance check → auto-recount → analyst review → posted adjustment*.

- **ABC-frequency scheduling:** A-items counted weekly-to-quarterly, C-items annually; the daily queue is simply "items whose count is most overdue, capped at N." Business Central reduces this to one field per item (a counting period) plus a "what's due" query.
- **Opportunistic counting is the best counting:** when a pick leaves 0–2 units in a bin, verification takes two seconds and the error impact (a stockout MRP can't see) is highest — SAP's low-stock check and D365's thresholds count at exactly that moment, in the same trip.
- **Blind counts or it's confirmation bias:** never show the counter the expected quantity. D365 has a per-menu toggle for hiding the book number and a forced-recount-on-mismatch setting; it even grants *per-worker* variance authority — a trusted counter's small differences self-approve, a junior's queue for supervisor review.
- **Tolerance gates:** SAP EWM runs three tiers — recount tolerance (auto-generate a recount, ideally by a different counter), difference-analyzer tolerance (human dispositions it), posting tolerance (small variances auto-post). Humans see only material, confirmed discrepancies.
- **IRA is a hit rate, not a netted total:** +5 of one part and −5 of another is 0% accurate to operations even if the dollar view says 100%. MRP is considered unreliable below ~95% record accuracy.
- **The root fix is fewer transactions:** record errors are proportional to transaction count (Strategos). Kanban, backflush, and point-of-use storage prevent errors; counting only removes them. And robots are dissolving the sampling tradeoff entirely — Verity drones and Dexory's mast robot (10,000 locations/hour) do nightly wall-to-wall counts; the residual human job is adjudicating flagged variances.

> **Transferable:** Two fields — `count interval` and `last verified` — per item/location, plus an opportunistic prompt ("marking 3 used — how many are actually left?") when quantity drops low, reproduce the essential mechanics almost exactly.

---

## Mechanics 06 — Computing the numbers & tracing the parts

### The planning layer nobody sees

The answer to "what number goes in the min field" is a pipeline, not a formula: (1) measure demand and its variability from transaction history; (2) classify the part — ABC by consumption value × XYZ by demand variability, a 9-cell matrix that assigns the *policy*, not the quantity; (3) pick a service target per class; (4) compute the reorder point from the part's own lead time and variability; (5) re-run periodically. The documented industry anti-pattern is "safety stock = N weeks of demand" — it ignores lead time, so long-lead parts get chronically under-buffered.

Notable: ToolsGroup's *stock-to-service curve* (plot achieved service level against inventory investment, choose a point per part) is the cleanest mental model in the field; and LeanDNA's success (30–39% shortage reduction) proves the killer feature is workflow, not math — every predicted shortage becomes *one prioritized, owned action* (expedite this PO, cancel that one). Curated data plus ranked to-do lists beats sophisticated math nobody acts on.

### Traceability is a pointer tree

The IPC-1782 pattern: assign each incoming lot one internal ID at receiving; every consumption record *points* at it instead of copying data. Both recall directions become cheap queries — "what's inside unit X" (trace back) and "which units contain lot Y" (trace up). In SMT, the pick-and-place machine emits a record per component placement (reel ID → board ID → reference designator), and a feeder-slot interlock refuses to run if the scanned reel+feeder+slot triple doesn't match the setup — wrong-part defects drop to near zero. The MSL (moisture-sensitivity) discipline is just an expiry state machine per lot: opened-at timestamp, cumulative exposure budget, bake-out resets the clock — a genuinely useful concept for anything degradable (glue, solder paste, batteries).

---

## What Eventory can steal

Ranked by leverage-per-effort, mapped to the app's existing feature set (items, photos, location tree, QR labels, tags, BOM projects):

1. **Split Part from Stock Item.** A part is a definition (what it is, datasheet, BOM role); a stock item is a physical quantity at a location with its own lot and history. Conflating them is the classic small-app modeling mistake; every serious system from InvenTree to Opcenter makes this split. *(from: InvenTree, PartsBox, all enterprise MES)*
2. **Make the movement ledger the primary structure.** Record every add/move/consume as an event; treat on-hand as a projection. This unlocks history, genealogy, and undo almost free. *(from: WMS warehouse tasks, Plex scan-everything)*
3. **Let location nodes carry behavior.** Min/max, replenishment rule, preferred container, count interval as attributes on tree nodes — a location tree becomes WMS-like the moment nodes hold rules and the app suggests where to put and take from. *(from: SAP storage types, production supply areas)*
4. **One-tap "bin empty" → shopping list.** Scan a location QR, tap once, a replenishment entry appears. This is the entire essence of e-kanban, and it beats any dashboard. *(from: SAP kanban state machine, Würth/Bossard smart bins)*
5. **Backflush BOM projects, recording lots.** When a build is marked done, auto-deduct components and store pointers to the specific lots consumed — bidirectional genealogy ("which projects used this bag of parts?") falls out for free. *(from: backflushing, IPC-1782 pointer tree, Katana)*
6. **Compute min/max instead of asking for it.** A periodic job that recomputes reorder points from consumption history (even crudely) reproduces the enterprise planning-layer-with-write-back architecture at hobby scale. ABC/XYZ classification is a SQL query. *(from: LeanDNA, SAP IBP, SyncKanban auto-resize)*
7. **Count interval + last-verified + opportunistic prompts.** "Today's count list = most overdue first, capped at N," blind entry, and a "how many are actually left?" prompt when stock drops low. *(from: BC counting periods, SAP low-stock check, D365 thresholds)*
8. **Distributor-barcode receiving.** DigiKey/Mouser labels carry DataMatrix codes encoding MPN, quantity, lot, and date code — one scan creates a fully-attributed stock lot with zero typing. The highest-leverage receiving feature for any electronics-adjacent inventory. *(from: PartsBox, InvenTree plugins)*
9. **Give boxes their own identity.** A container with its own QR, capacity, and contents-by-lookup enables move-the-box-scan-once workflows and the manifest-diff pattern for relocations. *(from: handling units / license plates, Odette GTL)*
10. **Adopt GS1 Digital Link URIs for labels.** Encode QR labels as HTTPS URIs (`…/01/{item}/21/{serial}` style): phone cameras get a web page, scanners get structured IDs, and the scheme aligns with Sunrise 2027 and EU DPP conventions for free. *(from: GS1, EU Digital Product Passport)*
11. **Expiry state machines for degradables.** Opened-at + exposure budget + reset event, per lot — the MSL pattern generalized to glues, batteries, filament. *(from: JEDEC J-STD-033, Opcenter/Neotel MSL tracking)*
12. **Per-build kitting lists.** Generate a pick list for a project ordered by assembly step, with reserve/allocate vs. pick-now states — the personal version of kit release gating and delta kitting. *(from: BOM-driven kitting, Aegis delta kitting)*

---

## Sources

Consulted by the research agents, grouped by angle. Vendor documentation was preferred for mechanics; implementation-partner and practitioner material for how things actually run.

### ERP / MRP
- [SAP Learning — kanban production process](https://learning.sap.com/courses/production-integration-with-sap-s-4hana-ewm/using-kanban-as-production-process)
- [Microsoft — backflush costing (D365)](https://learn.microsoft.com/en-us/dynamics365/supply-chain/cost-management/backflush-costing)
- [Odoo — reordering rules](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html)
- [Symestic — just-in-sequence](https://www.symestic.com/en-us/what-is/jis)
- [P&MR — line-feeding decision models](https://www.tandfonline.com/doi/full/10.1080/21693277.2023.2200808)

### PLM / BOM
- [DemystifyingPLM — eBOM vs mBOM](https://www.demystifyingplm.com/ebom-vs-mbom)
- [Siemens — BOM management in ETO change](https://blogs.sw.siemens.com/teamcenter-manufacturing/2025/02/19/steps-for-effective-bom-management-in-the-eto-change-process/)
- [LEAP — BOMs in Windchill](https://www.leapaust.com.au/blog/dx/how-to-manage-your-boms-in-windchill/)
- [Arena — AML](https://www.arenasolutions.com/resources/glossary/approved-manufacturer-list/)
- [OpenBOM — ERP integrations 2025](https://www.openbom.com/blog/openbom-erp-integrations-circa-2025-from-seamless-sync-to-ai-agentic-workflows)

### WMS / intralogistics
- [SAP Learning — production supply in EWM](https://learning.sap.com/courses/processes-in-sap-s-4hana-ewm/executing-the-production-supply-process)
- [Onespire — putaway control in EWM](https://onespire.net/putaway-control-in-sap-ewm-warehouse-management-system/)
- [Manhattan — order streaming](https://www.manh.com/solutions/supply-chain-management-software/warehouse-management/order-streaming)
- [Optel — Lean Kitting study](https://www.optelco.com/pdf/Lean-Kitting.pdf)
- [SupplyVelocity — bin location coding](https://www.supplyvelocity.com/lean-warehouse-aisle-bay-level-position-bin-location-coding/)

### Lean / e-kanban
- [Lean.org — Plan For Every Part](https://www.lean.org/the-lean-post/articles/why-a-plan-for-every-part-is-essential-to-lean-transformations/)
- [Synchrono — SyncKanban](https://www.synchrono.com/software/ekanban/)
- [Würth — iBin](https://www.wuerth-industrie.com/web/en/wuerthindustrie/cteile_management/kanban/kanban_steuerung/ibin_intelligenterbehaelter/ibin.php)
- [Bossard — SmartBin supermarket](https://www.bossard.com/us-en/services/smart-factory/inventory-management/leaner-b-and-c-parts-management/supermarket/)
- [Royal 4 — WISE sequencing](https://www.royal4.com/auto-parts-manufacturing-software/wise-automotive-sequencing/)
- [AllAboutLean — JIS](https://www.allaboutlean.com/just-in-sequence-definition/)

### Electronics / SMT
- [Cogiscan — automotive traceability](https://cogiscan.com/traceability-electronics-manufacturing-automotive-journey)
- [Aegis — MRP-logistics (delta kitting)](https://aiscorp.com/en/operational-excellence/mrp-logistics-software)
- [PartsBox — FAQ](https://partsbox.com/faq.html)
- [InvenTree — stock docs](https://docs.inventree.org/en/stable/stock/)
- [Siemens — Opcenter Intra Plant Logistics](https://www.siemens.com/en-us/products/opcenter/intraplant-logistics/)
- [Selektro — smart storage + X-ray counting](https://selektro.dk/en/storage-expansion-and-x-ray-counting/)

### Identification / traceability
- [GS1 US — Sunrise 2027](https://www.gs1us.org/industries-and-insights/by-topic/sunrise-2027)
- [Cogiscan — IPC-1782 Level 4](https://cogiscan.com/traceability-modern-electronics-manufacturing-ipc-1782-level-4)
- [Odette — GTL labelling](https://www.odette.org/process/labelling)
- [EU — battery passports](https://single-market-economy.ec.europa.eu/single-market/digital-product-passport/batteries_en)
- [RFID for returnable containers](https://www.rfidhy.com/how-european-automotive-oems-use-rfid-to-track-returnable-transport-items-rti/)

### Inventory optimization
- [LeanDNA — capabilities](https://www.leandna.com/capabilities/)
- [Lokad — independent LeanDNA review](https://www.lokad.com/review-of-leandna-com/)
- [ToolsGroup — MEIO guide](https://www.toolsgroup.com/blog/multi-echelon-inventory-optimization-toolsgroup-guide/)
- [SAP Press — safety stock in IBP](https://blog.sap-press.com/how-to-calculate-safety-stock-with-sap-ibp-for-inventory)
- [EyeOn — ABC/XYZ segmentation](https://eyeonplanning.com/blog/abc-xyz-segmentation/)

### Cycle counting / IRA
- [Microsoft — D365 cycle counting](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/cycle-counting-scenarios)
- [SAP Learning — physical inventory in EWM](https://learning.sap.com/courses/processes-in-sap-s-4hana-ewm/performing-a-physical-inventory)
- [Strategos — inventory record accuracy](https://strategosinc.com/RESOURCES/10-Inventory/CC1-inventory_record_accuracy.htm)
- [Dexory — autonomous counting robots](https://www.dexory.com/)

### Supplier inbound / EDI
- [SupplyOn — EDI information package](https://supportcenter.supplyon.com/system/files/content-public/document/scm_edi_information_package_en.pdf)
- [Bosch — GTL guideline](https://assets.bosch.com/media/global/bosch_group/purchasing_and_logistics/information_for_business_partners/downloads/logistics_docs/gtl-guideline.pdf)
- [EDICOM — OEM/tier EDI integration](https://edicomgroup.com/blog/edi-integration-oem-tier-automotive)
- [WSW — cumulative quantity management](https://www.wsw.de/en/processes/sap-data-management-cumulative-quantity-management/)
- [SAP MM consignment explained](https://portsapblogging.com/2024/02/09/sap-mm-consignment-how-it-works-why-it-matters-and-how-to-run-it-well/)
