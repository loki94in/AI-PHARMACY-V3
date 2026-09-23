# Prescription Image → OCR → DB Matching → In-App Medicine Suggestions — Implementation Plan

> **Status:** PLAN ONLY — No code changes in this document. For engineering execution later.
> **Date:** 2026-09-21
> **Workspace:** `E:\CURRENT PROJECT ON WORKING\AI PHARMACY v2`
> **Author:** Muse Spark (OpenCode agent)
> **Location:** `rtt/PRESCRIPTION_IMAGE_OCR_DB_MATCH_IMPLEMENTATION_PLAN.md` (canonical) — mirrored to root `PRESCRIPTION_IMAGE_OCR_DB_MATCH_IMPLEMENTATION_PLAN.md`

---

## 0. How to Use This Plan

- Read `AGENTS.md` + `AGENT_BUG_FIX_RULEBOOK.md` + `BACKEND SCHEMA SAFETY.md` before any phase starts.
- Every code phase must end with `npm run guardrails` (exit 0) and `node scripts/quick-update.mjs` (knowledge graph refresh).
- Each phase is independently shippable; do **not** start Phase N+1 until Phase N guardrails pass.
- No dummy data, no `B-*` batches, no `MANUAL`/`BATCH123` fallbacks — see §11 Strict Legitimate Data.

---

## 1. Executive Summary

**Current:** App successfully forwards prescription / medicine images (WhatsApp `message_create` → `saveInboundMedia` → `GET /api/messaging/wa-media/:msgId`). Website `PrescriptionUploadModal` uploads up to 10 images but only the first is OCR'd.

**Desired:** After any image arrives (WhatsApp, Website, Mobile camera, POS AICamera), the app runs a **single unified OCR pipeline**, matches every detected medicine line against the master `medicines` DB (291,878 rows, FTS5 trigram), resolves live stock (`inventory_master` batched `is_active=1`), classifies availability (`IN_STOCK / REGISTERED_NO_STOCK / EXTERNAL_ONLY / NON_ALLOPATHIC`), optionally does **one batched Pharmarack live search per distinct medicine**, persists structured `prescription_scans + prescription_scan_items`, broadcasts `prescription_scan_complete` + `wa_medicine_match` via the single global SSE `GET /api/notifications/stream`, and renders **in-app suggestion chips** in three surfaces: Website modal (customer), `/ai-engineering?tab=wa` (pharmacist), POS (billing). All existing forwarding stays untouched.

**Key decision:** Unify two divergent OCR stacks (`prescriptionScannerService.ts` vs `aiCameraService.ts`) behind one orchestrator (`prescriptionOrchestratorService.ts`) instead of patching each flow separately.

---

## 2. Current State Map (with file:line anchors)

### 2.1 Image Ingest — Already Works (Keep As-Is)

| Source | Entry | Persistence | Serve |
|--------|-------|-------------|-------|
| WhatsApp | `src/whatsappClient.ts:1181` `client.on('message_create', …)` → `src/services/whatsappIntentService.ts:2853` media ladder (`downloadMessageMediaReliably` → `downloadMediaWithRetry` 3× → hydrated chat retry → `downloadMessageMediaById` → deferred 30s retry) | `src/services/whatsappIntentService.ts:80` `saveInboundMedia(msgId, buf)` → `data/inbound_media/<safeId>.jpg` + `<appDataDir>/uploads/<safeId>.jpg` (`[^a-zA-Z0-9_-]` sanitized) | `src/routes/messaging.ts` `GET /api/messaging/wa-media/:msgId` (read-only, `WaThumb` module-cache one fetch ever) |
| Website | `frontend/src/components/PrescriptionUploadModal.tsx` `optimizeImageForUpload(1400px,0.82)` → `api.scanPrescription(base64)` → `api.submitPrescriptionRequest({images|image, …})` | `src/routes/websiteOrders.ts` `POST /api/website/prescription-request` `compressAndSave` → `uploads/prescriptions/Rx_Web_<ts>_<n>.jpg` → `special_orders.prescription_url TEXT` (single or JSON-array), `special_orders.notes` freeform AI intel | `GET /prescriptions/Rx_Web_*.jpg` via static + `WebsiteOrders/index.tsx` carousel |
| POS / Mobile | `src/routes/sales.ts:3518` `POST /api/sales/prescription/upload` stores Rx image; `pharmacy-mobile/app/camera/index.tsx` `scanModes medicine|purchase_bill|prescription` → `POST /ai-camera/analyze` | Same as website | Inline |

### 2.2 OCR — Two Stacks, One Must Win

**Stack A — `src/services/prescriptionScannerService.ts` (451 LOC, website-only):**
`Buffer → Jimp 1200px greyscale+contrast0.25 → Tesseract `PSM.SINGLE_BLOCK` (eng, preserve_interword_spaces:1) → `normalizeHandwritingGlyphs()` (pole→Dolo, fap→Pan, 20omg→200mg) → `parsePrescriptionText()` line-split → header/doctor/patient regex → `isMedicineLine` (tab/cap/syp/inj OR \d+mg OR known brand) → tokenise deg lued line → `SELECT medicines WHERE name LIKE 'primary %' + strength + form LIMIT 3` fallback `LIKE 'token%'` → if 0 items + Gemini key → `extractWithGeminiVision` (gemini-1.5-flash, 8s timeout, Indian Rx prompt) → re-parse → `PrescriptionScanResult {doctorName, clinicName, patientName, items:[{rawText, brandName, dosageForm, strength, qty, matchedMedicines[]}], rawOcrText}`. Timeout 5 min `Promise.race`. **Ignores** visual pHash, V2 gate, `enhancedSimilarity`.

**Stack B — `src/services/aiCameraService.ts` (~1279 LOC, WhatsApp/Telegram/Purchases, mature):**
`Jimp 1200 greyscale → Gemini 2.0 Flash (if `app_settings.gemini_api_key` or env, 15s) JSON `{isPrescription, medText}` → ONNX `services/onnxOcrService.ts` (PaddleOCR, lazy model, 105 min idle unload) → Tesseract `PSM.SPARSE_TEXT` whitelist `A-Z0-9.-/:,()+₹mgμ%` + `medicine_dict.txt` → `visualIndexService.searchByPhash` ≤10 → `detectKnownApi` (`medicine_reference`+`api_substances`) → `candidateLines` filtering (`isPackagingOrCompositionLine`, `STOP_WORDS`, `KNOWN_COMPANIES` 727+500, strip promo) → per-line `productNameFilterService.filterProductNames(minConfidence 0.65, dosageForm, mrp)` early-exit `topScore≥0.88` → token-level fallback (3 tokens ≥5) → strength/volume/modifier re-rank (`dosageConflict -0.40`, `modifierConflict -0.45`) → `finalInfo{potentialName, …}` → optional `onlineDataEnricher` / `scispacyClient` (skipped when `skipEnrichment=true` from `ocrScanQueue`).`

**Bridge already exists but unused on website:** `services/productNameFilterService.ts:550 enhancedSimilarity` (Levenshtein 0.6 + Soundex 0.2 + bigram 0.2, modality 0.20, umbrella 0.20, formulation modifier -0.45), `services/visualIndexService.ts:fusedSearch(≤12, ≥75)`, `scanGateAlgorithms.ts` V2 gate.

### 2.3 Queue & Broadcast — WhatsApp Proven Path

`src/services/ocrScanQueue.ts` (`MAX_CONCURRENT=2`, `processing:Set`, `done:Set`) `enqueue(msgId, buf, {phone, chatId, imagePath})` → `runScan → aiCameraService.processImage(buf, true) → cached scanned_messages → broadcast('ocr_scan_complete') → handleOcrComplete(data)` (direct, server.ts listener is redundant).

`src/services/whatsappIntentService.ts:3724 handleOcrComplete` pipeline:
`isPromotional` drop → payment screenshot human-loop gate (`special_orders.payment_status='PENDING_VERIFICATION'` → attach `data/inbound_media`, `order_tracking_events`, broadcast `order_updated`, return) → prescription branch (`ocrResult.isPrescription` → per-item `filterProductNames` + `resolveInventoryStock` batched → `waAdminEscalationService.notifyAdminOfPrescription` + customer `📋 Prescription Received! … RX …`, return) → single-medicine path (`potentialName || plausible line || textParsed` → `isPlausibleMedicineName` gate → `extraCandidates` from generic/api/caption/OCR lines cap 4 → V2 gate per candidate via `knownApis` (`api_substances`+`medicine_reference` top 5k) → `visual fusedSearch` promote if `fusedScore≥75` → `resolveRelatedMedicinesLocal(passing.slice(1))` (local-only, one-photo-one-result) → ONE `searchAndBroadcast(primary)`).

`src/services/whatsappIntentService.ts:3277 searchAndBroadcast`:
`filterProductNames(0.60)` → `resolveInventoryStock` (exported batched `SELECT m.name, SUM(im.quantity+loose_quantity) WHERE LOWER(m.name) IN (…) AND is_active=1 GROUP BY`, lowercased keys) → `classifyAvailability` → `detectNonAllopathicKind` (`cosmetic/ayurvedic/homeopathy` → `NON_ALLOPATHIC`, skip Pharmarack unless `isExactLocal≥0.95 && IN_STOCK`) → `searchCatalog` (offline `pharmarackCatalogCache`, always) → `performPharmarackSearch` (ONE live, `sanitizePharmarackQuery` 2-3 core words, cross-check `scoreProductName≥0.65` + `pharmarackRank<max(10, ceil(len*0.25))`) → `passesGate(bestScore, hasIntentWords, source, hasConfirmedMatch)` `0.60` with intent / `0.72` bare → `broadcast('wa_medicine_match', {customer, isNewCustomer, medicineName, quantity, unit, dosageForm, localMatches, inventoryStock, availability, catalogResults, confidence, source, messageBody, history, livePharmarackResults, mediaId, relatedMedicines, isStale})` → persist `wa_medicine_requests` → `waAdminEscalationService.maybeEscalate` (+imagePath) → customer `awaiting_selection`/`awaiting_medicine_confirmation` + `shortageReminderService.trackMedicineRequest`.

**Frontend SSE:** `src/services/eventService.ts` single SSE `GET /api/notifications/stream` → `frontend/src/hooks/useGlobalSseInvalidation.ts:56` `wa_medicine_match → CustomEvent('sse-wa-medicine-match')` → `frontend/src/pages/AIEngineering/WaRequestsPanel.tsx` (module `feedCache` cap 50, `WaMatchCard` with `IN_STOCK` emerald / `REGISTERED_NO_STOCK` amber / `EXTERNAL_ONLY` rose / `NON_ALLOPATHIC` violet, `WaThumb` via `GET /wa-media`, `Also on this strip` from `relatedMedicines`, Pharmarack balanced `MIN_MAPPED=5, MIN_NON_MAPPED=2`). Manual lookup `api.searchPharmarack(q)` exactly ONE per click.

### 2.4 DB — Medicine Master Ready, Prescription Struct Missing

`src/database.ts:1401 CREATE TABLE medicines` (~32 cols: `name`, `canonical_name`, `normalized_name`, `product_code`, `dosage_form`, `pack_size`, `mrp`, `manufacturer`, `api_reference`, `schedule_type H/H1/X`, `item_code UNIQUE`, `total_stock/loose_stock/last_purchase_*` trigger-maintained) `291,878 rows` (286,389 baseline +5,489 import, `scripts/importMedicineNames.mjs`, dedupe `lower(collapse whitespace)`). FTS5 `medicines_fts` trigram `tokenize='trigram'` `src/database.ts:13` with triggers `medicines_ai/ad/au`. Indexes `idx_medicines_name(_nocase)`, `idx_medicines_name_mfg`, prefix `LIKE 'term%'` <5ms; fallback `<15` → `%term%` / FTS5. **Prescription gap:** `special_orders` stores `prescription_url TEXT` (or JSON array) + intel in `notes`; no `prescription_scans` / `prescription_scan_items`, no `raw_ocr_text`, no per-item `matched_medicine_id/confidence`.

### 2.5 Search Hot Paths Already Contracted

- `GET /api/inventory/catalog-search` (`src/routes/inventory.ts:573`) prefix `name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 40` (idx_nocase) → alias prefix 20 → FTS5 trigram `tokens+'*' AND` 30 → numeric/acronym fallback → alphanumeric dedupe.
- `GET /api/sales/search-medicine` (`src/routes/sales.ts:1562`) same pattern on `inventory_master JOIN medicines is_active=1 quantity>0`.
- Availability engine `src/services/medicineAvailabilityEngine.ts:49` exact→prefix 15→composition/category→fuzzy.

---

## 3. Gaps to Close (Why This Plan Exists)

1. **Divergent OCR** — fixes on `aiCameraService` don't flow to `prescriptionScannerService`; website loses visual pHash, V2 gate, `enhancedSimilarity` modifier guards.
2. **Website multi-page drop** — uploads 10 photos, only `imagePaths[0]` OCR'd in `prescriptionIntelService`.
3. **No structured prescription model** — no itemized stock/Pharmarack per line, no `raw_ocr_text`, no audit.
4. **No customer-facing suggestions** — intel is void-sent to pharmacy WhatsApp, not SSE'd back to browser; `autoScanFirstPhoto` hardcodes `confidence:95`, no `scoredMatches`.
5. **Inconsistent matchers** — `LIKE 'firstWord%'` vs FTS5; not reusing `filterCache` 2000 LRU.
6. **Queuing / gating divergence** — WA has `MAX_CONCURRENT=2`, dedup, 2s chat gate; website fires Gemini per image without shared bucket.

---

## 4. Goals / Non-Goals

**Goals:**
- Single OCR+match orchestrator reused by WhatsApp, Website, POS, Mobile.
- Multi-image prescription → itemized suggestions with truthful stock badges (batched `is_active=1` SUM, not guessed).
- One batched Pharmarack live search per distinct medicine (not N serial).
- SSE in-app suggestions (mark-stale-only deferred, KeepAlive-safe).
- Schema audit-safe (fast-boot + DDL wall).

**Non-Goals (this plan):**
- No new Google scraping (crawler stays disabled per `googleSearchService.ts` gate).
- No auto patient WhatsApp on arrival (Manual-Only contract: status=`Ready`/`notified=0`, user clicks `Send Arrival WA`).
- No mock/simulation cart UI (live data only).
- No inventory auto-creation (purchase-verified only).

---

## 5. Target Architecture

```
[WhatsApp image] ─┐
[Website 1-10]  ──┼─> saveInboundMedia / compressAndSave ─> prescriptionOrchestratorService.scanPrescriptionImage(buf, {source, msgId})
[Mobile camera] ──┤         │  ├─ preprocess (Jimp 1200 greyscale) ─> Gemini 2.0 Flash? ─> ONNX PaddleOCR ─> Tesseract SPARSE_TEXT
[POS AICamera]  ──┘         │  ├─ visualIndexService.fusedSearch(≤12, ≥75) boost
                          │  ├─ normalizeHandwritingGlyphs + parsePrescriptionText (doctor/clinic) as enhancer
                          │  ├─ per-line productNameFilterService.filterProductNames(0.60/0.72) → scoredMatches
                          │  ├─ resolveInventoryStock (batched, is_active=1, SUM quantity+loose_quantity)
                          │  ├─ classifyAvailability + detectNonAllopathicKind guard
                          │  ├─ searchCatalog (offline) + ONE performPharmarackSearch per distinct (batched, sanitizePharmarackQuery)
                          │  └─ persist prescription_scans + prescription_scan_items
                          │         │
                          │         ├─ broadcast('prescription_scan_complete', {scanId, items, rawOcrText})
                          │         └─ broadcast('wa_medicine_match', …) (compat, WaRequestsPanel stays working)
                          │                  │
                 ┌────────┴──────────────────┴────────┐
                 │ SSE GET /api/notifications/stream  │ (single connection)
                 └────────┬──────────────────┬────────┘
           Website modal  WaRequestsPanel   POS AICamera
           (chips+Add)   (multi-item table) (FEFO chips)
```

**Key invariants:**
- One SSE connection (`eventService.ts`), `useGlobalSseInvalidation.ts` map, mark-stale-only (`refetchType:'none'`) + `PageQueryTracker` deferred; Chrome keys (`orders`, `refills`, `settings`) stay instant.
- KeepAlive: pages mounted once, hidden `display:none`; polls gated `usePageActive()`.
- Idle gating: `dataFetchControl` (`auto|manual|off`) + `activityTracker.isIdle() >30m` pauses catalog/Pharmarack batch when `manual`.

---

## 6. Data Model (BACKEND SCHEMA SAFETY §24)

Add in `src/database.ts` **both** places: `ensureSchema()` fast-boot block (~L658) and DDL wall (~L1401). Provide `ALTER TABLE ADD COLUMN` guards for upgrade from existing DB.

```sql
-- New tables
CREATE TABLE IF NOT EXISTS prescription_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('whatsapp','website','mobile','pos','telegram')),
  source_msg_id TEXT,                 -- whatsapp serialized id or null
  source_url TEXT,                    -- wa-media id or uploads/prescriptions path
  image_path TEXT NOT NULL,           -- primary image (first of bundle)
  image_paths_json TEXT,              -- JSON array for multi-page
  raw_ocr_text TEXT,
  doctor_name TEXT,
  clinic_name TEXT,
  patient_name TEXT,
  patient_age TEXT,
  is_prescription INTEGER DEFAULT 1,
  status TEXT DEFAULT 'scanned' CHECK (status IN ('scanned','reviewed','converted')),
  confidence REAL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  store_id INTEGER REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS prescription_scan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES prescription_scans(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  brand_hint TEXT,
  strength TEXT,
  dosage_form TEXT,
  prescribed_qty REAL DEFAULT 1,
  matched_medicine_id INTEGER REFERENCES medicines(id),
  match_score REAL,
  match_type TEXT,                    -- exact_name | fuzzy_name | visual_boost | unmatched
  availability TEXT,                  -- IN_STOCK | REGISTERED_NO_STOCK | EXTERNAL_ONLY | NON_ALLOPATHIC
  inventory_qty REAL DEFAULT 0,
  catalog_hit_json TEXT,
  pharmarack_hit_json TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prescription_scans_msg ON prescription_scans(source_msg_id);
CREATE INDEX IF NOT EXISTS idx_prescription_scans_created ON prescription_scans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescription_scan_items_scan ON prescription_scan_items(scan_id, line_index);
CREATE INDEX IF NOT EXISTS idx_prescription_scan_items_medicine ON prescription_scan_items(matched_medicine_id);

-- Optional link (non-breaking): keep special_orders.prescription_url as display, add nullable scan_id for join
-- ALTER TABLE special_orders ADD COLUMN prescription_scan_id INTEGER REFERENCES prescription_scans(id);
```

**Why this shape:**
- Mirrors `wa_medicine_requests` (audit trail) but itemized per-line, with `raw_ocr_text` preserved for Learning hub correction.
- `inventory_qty` is `SUM(quantity+loose_quantity) WHERE is_active=1` truth, not guessed `100`/`mrp*0.7`.
- `match_score` is `enhancedSimilarity` topScore 0.0-1.0; gate 0.60/0.72 applied upstream, stored for review queue triage.

**Seeds/migrations:** none beyond DDL; `scripts/importMedicineNames.mjs` contract untouched. Backfill: optional `UPDATE medicines SET total_stock …` already via triggers `trg_inventory_stock_*`.

---

## 7. Service Design — `src/services/prescriptionOrchestratorService.ts` (New)

**Interface:**
```ts
export type ScanSource = 'whatsapp'|'website'|'mobile'|'pos'|'telegram';
export interface PrescriptionScanRequest { buffer: Buffer; source: ScanSource; msgId?: string; imagePath?: string; storeId?: number; }
export interface PrescriptionScanResult {
  scanId: number;
  rawOcrText: string;
  isPrescription: boolean;
  doctorName?: string; clinicName?: string; patientName?: string;
  items: Array<{
    rawText: string; brandHint: string; dosageForm?: string; strength?: string;
    prescribedQuantity: number;
    matches: Array<{ medicineId:number; name:string; score:number; manufacturer?:string; mrp?:number; packaging?:string }>;
    topScore: number; availability: string; inventoryQty: number;
    catalogHits?: any[]; pharmarackHits?: any[];
  }>;
  visualBoostName?: string;
}
export async function scanPrescriptionImage(req: PrescriptionScanRequest): Promise<PrescriptionScanResult>
export async function scanPrescriptionBundle(buffers: Buffer[], meta: Omit<PrescriptionScanRequest,'buffer'>): Promise<PrescriptionScanResult>
```

**Internal steps (reuse, don't reimplement):**
1. `preprocessImage` (Jimp 1200 greyscale contrast 0.25) — shared helper extracted from `aiCameraService`.
2. `getGeminiKey()` from `process.env.GEMINI_API_KEY || app_settings.gemini_api_key` — 15s timeout, single-flight per image (dedup via `ocrScanQueue.done`).
3. Tiered OCR: Gemini 2.0 → ONNX (`onnxOcrService.scanImage`) → Tesseract (`PSM.SPARSE_TEXT`, whitelist, `medicine_dict.txt`). Keep ONNX idle unload 105m.
4. Handwriting enhancer: `prescriptionScannerService.normalizeHandwritingGlyphs` + `parsePrescriptionText` line-split as **post-processor** on raw Tesseract text (not separate path) — merges `pole→Dolo` etc.
5. `visualIndexService.fusedSearch(buf, ocrRaw, {limit:3, maxVisualDistance:12})` if imagePath/buffer present; promote if `fusedScore≥75`.
6. Candidate lines: `isPlausibleMedicineName` → `extractCandidateTokens` → `productNameFilterService.filterProductNames` per line (FTS5 trigram `'"term"'` + `mrp BETWEEN ±40%` when numeric, `dosageConflict -0.40`, `modifierConflict -0.45`) cap 4 extras; cache key `normalized|dosageForm|mrp|…|threshold` LRU 2000.
7. Batched `resolveInventoryStock(allMatches)` (one DB round-trip, `LOWER(name) IN (…)`).
8. Per distinct medicine: `sanitizePharmarackQuery` → `pharmarackCatalogCache.searchCatalog` (always) → `performPharmarackSearch` (ONE live per distinct, 8s + 5s retry capped 10) — **batch, not N serial**; gate `scoreProductName≥0.65` + rank guard.
9. Persist `prescription_scans` + `prescription_scan_items` in one transaction.
10. `eventService.broadcast('prescription_scan_complete', {scanId, source, items: slim})` + compat `broadcast('wa_medicine_match', …)` for WaRequestsPanel.

**Why orchestrator wins over patching both stacks:** One FTS5 cache, one inventory batch, one visual fusion, one Pharmarack budget; can't drift. `prescriptionScannerService.scanPrescription` becomes a thin wrapper calling orchestrator (deprecate direct `LIKE 'primary %'` loops).

---

## 8. API & SSE Contracts

| Endpoint | Method | Auth | Purpose | Notes |
|----------|--------|------|---------|-------|
| `POST /api/prescriptions/scan` | POST multipart or `{imageBase64}` | session | Single image scan → `PrescriptionScanResult` + SSE | Replaces direct `POST /api/aicamera/scan-prescription` for new callers; old route stays compat wrapper. |
| `POST /api/prescriptions/scan-bundle` | POST `{images: base64[]}` | session | Multi-page (website 1-10) → merged items deduped by alphanumeric `lower(name).replace(/[^a-z0-9]/g,'')`, in-stock wins | Limits: 10 images, 5 MB each, total 15 MB; 20s per-image timeout `Promise.race`. |
| `GET /api/prescriptions/:scanId` | GET | session | Fetch scan + items | For modal refresh after SSE race. |
| `GET /api/messaging/wa-media/:msgId` | GET | session | Existing image serve | Unchanged. |
| `GET /api/notifications/stream` | SSE | session | Add `prescription_scan_complete` event | Map in `src/services/eventService.ts` + `frontend/src/hooks/useGlobalSseInvalidation.ts:56`. |

**SSE payload `prescription_scan_complete`:**
```json
{
  "scanId": 123,
  "source": "website",
  "sourceMsgId": null,
  "isPrescription": true,
  "doctorName": "Dr. Sharma",
  "items": [
    {"rawText":"Dolo 650 1x10","brandHint":"Dolo","strength":"650mg","dosageForm":"TABLET","matchedMedicineId":4512,"matchScore":0.94,"availability":"IN_STOCK","inventoryQty":42}
  ],
  "rawOcrText": "…",
  "createdAt": "2026-09-21T…Z"
}
```

**Guardrails:** No `refetchInterval`/`setInterval` pollers; SSE `refetchType:'none'` mark-stale-only, `PageQueryTracker` per-page deferred fetch. No `text-text` on accent fills.

---

## 9. UI Changes (No Mock Data)

### 9.1 Website `frontend/src/components/PrescriptionUploadModal.tsx`
- Keep `optimizeImageForUpload` + file input 1-10.
- Replace `autoScanFirstPhoto` direct `api.scanPrescription` with `POST /api/prescriptions/scan-bundle` (all images). While scanning: show skeleton (module-cache instant paint pattern, no spinner blocking).
- On result: render **SuggestionPanel** per `items` (reuse `WaMatchCard` styling but customer-friendly): `Brand · Strength · Form` + `IN_STOCK` emerald badge with `inventoryQty` truth or `OUT OF STOCK · Pharmarack: distributor PTR` (catalog/live). `Add to Order` → existing `api.submitPrescriptionRequest` now with `prescription_scan_id`.
- Subscribe `sse-prescription-scan-complete` CustomEvent (via `useGlobalSseInvalidation`) for pharmacist-side live update if modal still open; dedupe by `scanId`.

### 9.2 Pharmacist `frontend/src/pages/AIEngineering/WaRequestsPanel.tsx`
- Already live `wa_medicine_match` feed (cap 50, `feedCache`). Extend card: when `isPrescription` + `items.length>1`, render multi-row table (rawText | matched | stock | Pharmarack) instead of single medicine line. Keep `WaThumb`, `Also on this strip` (`relatedMedicines` local-only), Pharmarack balanced list (`MIN_MAPPED=5, MIN_NON_MAPPED=2, MAX_NON_MAPPED=3`). No auto-retry; manual `api.searchPharmarack` ONE per click stays.
- Add `sse-prescription-scan-complete` listener alongside existing `sse-wa-medicine-match` to pick up website/mobile scans in same feed.

### 9.3 POS `frontend/src/pages/POS/index.tsx` + `pharmacy-mobile/app/camera/index.tsx`
- `AICamera` lazy modal: add `scanMode='prescription'` → `POST /api/prescriptions/scan` → chips `row-med-input-*` trailing row compatible; `fetchDetailsAndChangeRowMedicine` path reused.
- Mobile `scanModes medicine|purchase_bill|prescription` already routes; prescription mode now hits orchestrator and returns suggestion list for in-app add-to-cart.

**Semantic colors only:** `bg-bg`, `bg-bg2`, `text-text`, `text-muted`, `border-border` etc. Accent fills (`bg-primary`) use `text-white`.

---

## 10. Detailed Phase Plan (No Code Yet)

### Phase 0 — Prep & Audits (0.5 day, no schema)
- [ ] Read `AGENTS.md`, `BACKEND SCHEMA SAFETY.md`, `SMALL_BUG_FIX_PLAN.md` §4 open issues.
- [ ] Run `node scripts/quick-update.mjs` + `npm run guardrails` baseline; capture `tsc --noEmit` 0.
- [ ] Snapshot `medicines` count `SELECT COUNT(*)` + `medicines_fts` integrity `SELECT count(*) FROM medicines_fts`.
- [ ] Review `scripts/performance-guardrails.mjs` ALLOW block; note if orchestrator needs exception (should not).

### Phase 1 — Schema + Orchestrator Skeleton (1.5 days)
- [ ] `src/database.ts`: add `prescription_scans` + `prescription_scan_items` DDL in both fast-boot + DDL wall + `ALTER` guards; indexes `src/database.ts:853` style.
- [ ] `src/services/prescriptionOrchestratorService.ts`: create module, extract `preprocessImage`, wire tiered OCR reuse (no new Tesseract worker — share `aiCameraService` worker or lazy create), integrate `visualIndexService` + `productNameFilterService` + `pharmarackCatalogCache` + `performPharmarackSearch` (sanitize + gate).
- [ ] `src/routes/prescriptions.ts` (new router): `POST /scan`, `POST /scan-bundle`, `GET /:scanId`; register in `src/server.ts`.
- [ ] `src/services/eventService.ts` + `frontend/src/hooks/useGlobalSseInvalidation.ts`: add `prescription_scan_complete` mapping (deferred, not instant chrome).
- [ ] Verify: `tsc --noEmit` 0, `npm run guardrails --self-test` if scanner edited, manual `curl POST /api/prescriptions/scan` with sample `SAMPLE IMAGE/*` → returns `items` with `matchScore`.

### Phase 2 — WhatsApp Unification (0.5 day)
- [ ] `src/services/ocrScanQueue.ts:runScan` → call `prescriptionOrchestratorService.scanPrescriptionImage` when `isPrescription` hint or always (compat: keep `aiCameraService.processImage` fallback if orchestrator returns empty).
- [ ] `src/services/whatsappIntentService.ts:handleOcrComplete` prescription branch → delegate enrichment to orchestrator (remove per-item `filterProductNames` loop, use batched result).
- [ ] `waAdminEscalationService.notifyAdminOfPrescription` — include `scanId` link `?tab=wa&scan=ID`.
- [ ] Verify: send test WhatsApp image (or `scripts/test_prescription_intel_flow.ts` harness) → `wa_medicine_match` SSE still fires, `wa_medicine_requests` + `prescription_scans` both written, `WaRequestsPanel` shows multi-row.

### Phase 3 — Website Multi-Image + In-App Suggestions (1 day)
- [ ] `src/routes/websiteOrders.ts`: `POST /api/website/prescription-request` — call `scanPrescriptionBundle(buffers)` for all images (Promise.all, batch inventory + batch Pharmarack), persist `prescription_scan_id` on `special_orders`.
- [ ] `frontend/src/components/PrescriptionUploadModal.tsx`: bundle upload path, `SuggestionPanel` chips, SSE `sse-prescription-scan-complete` subscription, `Add to Order` with `prescription_scan_id`.
- [ ] `frontend/src/pages/WebsiteOrders/index.tsx`: carousel already handles JSON array; add `prescription_scan_items` fetch for intel table (reuse `GET /api/prescriptions/:scanId`).
- [ ] Verify: upload 10 images → single scan returns deduped items, modal shows chips <2s after SSE, no Gemini storm (shared queue dedup), `GET /api/medicines/availability?query=` still <100ms.

### Phase 4 — POS / Mobile + Hardening (0.5 day)
- [ ] `frontend/src/pages/POS/index.tsx` AICamera prescription mode → orchestrator; `pharmacy-mobile/app/camera/index.tsx` same.
- [ ] `src/services/prescriptionScannerService.ts`: mark deprecated, wrapper to orchestrator; keep export for `scripts/test_offline_prescription_matcher.ts`.
- [ ] Add `dataFetchControl` idle gating to batch Pharmarack path; add `imageArchiveService` TTL for `uploads/prescriptions` (e.g., 90 days).
- [ ] Final audits: repo-wide dummy scan (`B-*`, `BATCH123`, `100`, `mrp * 0.7`, `Generic Medicine`), `node scripts/quick-update.mjs`, `npm run guardrails` (exit 0), `docs/KNOWLEDGE_GRAPH_DOCUMENTATION.md` regen `node scripts/generate-project-docs.mjs`.

**Total estimate:** ~3.5 days single engineer; each phase shippable.

---

## 11. Guardrails & Contract Compliance

- **Performance (AGENTS.md: SPA Performance & Data Fetch Control):** Module-level cache hydration, KeepAlive `usePageActive()` gating, deferred SSE (`refetchType:'none'`), no `refetchInterval`/`setInterval` ungated, `dataFetchControl auto|manual|off` idle `>30m` pause. Prefix `LIKE 'term%'` on `idx_medicines_name` first, FTS5 fallback only if `<15`.
- **Medicine Image Accuracy (`medicine-image-accuracy.md`):** Single-salt vs combination instant REJECT, exact brand suffix (`TELISTA` ≠ `TELISTA-MCL`), tablet↔capsule bidirectional shield — applied in `productNameFilterService` + `catalogImageService.computeConfidence`; never guessed image attach.
- **Zero Dummy Data (`Strict Legitimate Data`):** Missing `mrp/manufacturer/pack_size` stays null until purchase workflow fills; stock `SUM … WHERE is_active=1`; no `B-GEN`, `12/28`, `+91 99999` invented.
- **Manual-Only Patient Messaging:** Arrival WA queued only on user click `PUT /api/orders/:id/status` or `CRM SpecialOrdersSection` `Send Arrival WA` (idempotent `notified===1` skip) — orchestrator never auto-sends to patients.
- **Pharmarack Session Persistence:** Heartbeat probe `GetUserCartDetails` every `trigger_pharmarack_refresh_interval_min`; single-flight `executeRefresh()` mutex; profile lock clean + async copy; `warmupStartupCart` boot warm-up — none bypassed.
- **WhatsApp Idle-Sleep:** `whatsapp_idle_sleep_min` 15 default; `evaluateIdleSleep` every 60s; `GET /qr` never wakes sleeping; `sendMessage`/`getChats` auto-init only.
- **Page Ownership (`PROJECT_PAGE_AUDIT_DIRECTORY.md`):** Delivery boys via `/dispatch` + `delivery_boys`; special orders via `/orders` + `special_orders`; `AIEngineering` 4-tab hub owns composition/schedules/compliance/wa — legacy `/composition-queue` etc. stay silent redirects.
- **UI Guidelines:** Semantic Tailwind (`bg-bg`, `text-text`, `border-border`, `bg-glass-bg`); accent fills must use `text-white` (checked by guardrail `semantic-tailwind-colors`).

---

## 12. Testing & Verification

| Check | Command / Method | Pass Criteria |
|-------|------------------|---------------|
| Types | `npx tsc --noEmit` | 0 errors |
| Guardrails | `npm run guardrails` | exit 0 (no `alert()`, no ungated polling, single SSE, no dummy tokens) |
| Knowledge graph | `node scripts/quick-update.mjs` + `node scripts/generate-project-docs.mjs` | 0 duplicates, `PROJECT_AUDIT.md` fresh |
| Single scan | `curl -F image=@SAMPLE\ IMAGE/sample.jpg http://localhost:3000/api/prescriptions/scan` | `items[].matchScore≥0.60` when plausible, `rawOcrText` non-empty, `scanId` persisted |
| Bundle 10 | Website modal upload 10 | Deduped items, one `prescription_scans` row, `image_paths_json` length 10, <5s total |
| Stock truth | `SELECT SUM(quantity+loose_quantity) FROM inventory_master WHERE medicine_id=? AND is_active=1` vs card badge | Exact match |
| SSE | `GET /api/notifications/stream` single connection, hidden tab inactive | No refetch storm; `PageQueryTracker` deferred |
| Manual WA | Click `Send Arrival WA` in `/crm?tab=special_orders` | `whatsapp_queued:true`, second click idempotent |
| Dummy scan | `rg -n "B-GEN|BATCH123|Generic Medicine|100.*mrp"` | 0 hits outside tests/scripts/ALLOW |

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Gemini cost / rate limit per bundle | Med | Cost | Shared `done` dedup, `sanitizePharmarackQuery` 2-3 words, gate `0.60/0.72`, idle gating; consider ONNX-first if budget tight (Q1). |
| `Dolo 650` vs `Dolo 650 Plus` cross-match | Med | Wrong suggestion | Keep `hasFormulationModifierConflict -0.45` + `extractDrugStrength +0.15` guards; store `modifierConflict` flag. |
| Disk growth `data/inbound_media` + `uploads/prescriptions` | High | Disk pressure | Add `imageArchiveService` TTL 90d + `audit_images` pruning; `pHash` backfill manual note. |
| Tesseract `medicine_dict.txt` drift | Low | OCR miss | Learning hub `permanently_ignored_words` → `STOP_WORDS`; `ocr_corrections` JSON+SQLite `0.96` correction. |
| ScispaCy sidecar down | Med | Rescue names lost | Log warning metric; regex + FTS5 still covers; no silent fail in orchestrator — emit `fallbackUsed:true`. |
| FTS5 rebuild on new DB | Low | Search miss | `ensureMedicinesFts()` at boot, `backfillFts()` rebuild; verify `SELECT * FROM medicines_fts LIMIT 1`. |

---

## 14. Rollback

- Feature-flag: `GET /api/prescriptions/scan` falls back to `aiCameraService.processImage` if orchestrator throws (catch → legacy path).
- DB: new tables are additive; rollback is drop `prescription_scan_items` → `prescription_scans` if needed; `special_orders.prescription_scan_id` nullable so no FK break.
- SSE: WaRequestsPanel listens to both `wa_medicine_match` (old) and `prescription_scan_complete` (new) — removing new event is safe.
- No migration data loss: `medicines`/`inventory_master` untouched.

---

## 15. Open Questions (Need Owner Decision Before Phase 1)

1. **Gemini priority:** Keep Gemini 2.0 Flash first (accurate handwriting, cost) or ONNX-first with Gemini fallback only on 0 items (cheaper)? Default plan: Gemini first per current `aiCameraService`, shared bucket.
2. **Match gate for customer-facing chips:** `0.60` (with intent) vs stricter `0.72` bare text? Default: `0.60` for WA (pharmacist review), `0.72` for Website modal (customer sees only high-confidence).
3. **Mobile hit same endpoint?** Default: yes, `pharmacy-mobile/app/camera` prescription mode hits `POST /api/prescriptions/scan`. Confirm.
4. **Pharmarack batch cap:** Multi-item Rx with N distinct medicines → N live searches (risk). Default: cap at `3` live + rest `catalog-only`, pharmacist can manual `ONE search per click` for remainder.
5. **Retention:** `uploads/prescriptions` TTL? Default `90` days via `imageArchiveService`.
6. **Customer suggestion visibility:** Show chips to customer before order (website) or pharmacist-only? Default: both (customer modal + pharmacist WebsiteOrders intel).

---

## 16. Success Criteria (Done Definition)

- [ ] Upload 10 Rx images on website → SSE `prescription_scan_complete` delivers `items` with `localMatches` + `inventoryStock` truth + Pharmarack batched, modal renders chips without spinner, `Add to Order` creates `special_orders` with `prescription_scan_id`.
- [ ] WhatsApp photo still yields `wa_medicine_match` card in `/ai-engineering?tab=wa` (single live Pharmarack, `relatedMedicines` local-only, image via `GET /wa-media`).
- [ ] `GET /api/prescriptions/:scanId` returns persisted `raw_ocr_text` + per-item `match_score`/`availability`.
- [ ] `npm run guardrails` 0, `tsc --noEmit` 0, `node scripts/quick-update.mjs` + `docs/KNOWLEDGE_GRAPH_DOCUMENTATION.md` refreshed, `SMALL_BUG_FIX_PLAN.md` not regressed.
- [ ] Zero dummy tokens introduced; missing data stays missing; no auto patient WA.

---

## 17. Appendix — Key File References

- WA ingest: `src/whatsappClient.ts:1181`, `src/services/whatsappIntentService.ts:80,2853,3724,3277`, `src/services/ocrScanQueue.ts`, `src/services/waAdminEscalationService.ts`, `src/routes/messaging.ts`
- OCR: `src/services/aiCameraService.ts`, `src/services/onnxOcrService.ts`, `src/services/prescriptionScannerService.ts:scanPrescription`, `src/services/visualIndexService.ts:fusedSearch`, `src/services/productNameFilterService.ts:848,550`, `scanGateAlgorithms.ts`
- DB: `src/database.ts:8,124,173,658,769,1166,1401,1491,2595,3776`, `src/services/medicineService.ts:518`
- Search: `src/routes/inventory.ts:573`, `src/routes/sales.ts:1562,3518`, `src/services/medicineAvailabilityEngine.ts:49`, `src/routes/pharmarack.ts:479`
- SSE: `src/services/eventService.ts`, `frontend/src/hooks/useGlobalSseInvalidation.ts:56`, `frontend/src/pages/AIEngineering/WaRequestsPanel.tsx`
- Website: `frontend/src/components/PrescriptionUploadModal.tsx`, `frontend/src/pages/WebsiteOrders/index.tsx`, `src/routes/websiteOrders.ts`, `src/services/prescriptionIntelService.ts`
- POS/Mobile: `frontend/src/pages/POS/index.tsx`, `pharmacy-mobile/app/camera/index.tsx`, `src/routes/aiCamera.ts`, `src/routes/sales.ts:2048,2113`
- Guardrails: `scripts/performance-guardrails.mjs`, `scripts/quick-update.mjs`, `scripts/generate-project-docs.mjs`, `.agents/rules/medicine-image-accuracy.md`, `.agents/rules/backend-schema-safety.md`

---

*End of plan — no implementation performed. Next step is owner approval of §15 questions, then execute Phases 0→4 sequentially.*
