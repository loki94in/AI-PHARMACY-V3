# Small Bug Fix Plan — Bug Register

> Project bug register per `AGENT_BUG_FIX_RULEBOOK.md` Section 8. New defects go here
> as `Open`; fixed entries move to `Fixed` with root cause and verification.

---

## Fixed

### [Fixed] P1-22 — WhatsApp Promotional, Scheme & Broadcast Messages Auto-Created as Quick Special Requests

| Field | Content |
|---|---|
| **What the user saw** | When WhatsApp received marketing flyers, promotional broadcasts, or B2B scheme messages (such as Unilever/Shikhar promotions containing `*Start Saving🥰*` and `2️⃣Maximum Festive margins💰`), the system extracted each promo slogan as a medicine candidate, parsed numbered list emojis (`2️⃣`) as order quantities (`2`), and inserted them as pending customer special requests in **Quick Special Requests** under "Walk-in Customer". |
| **Root cause** | 1. Lack of promotional/broadcast filtering on inbound WhatsApp messages: marketing updates, festive offers, schemes, cashbacks, and broadcast emojis were routed to medicine extraction.<br>2. `isPlausibleMedicineName` checked only whether a string had $\ge 3$ Latin letters and wasn't purely digits, passing strings like `*Start Saving🥰*` and `Festive margins💰`.<br>3. In `extractMedicineCandidates`, keycap emojis (`2️⃣`) and numbered bullet prefixes were parsed by `parseInt` as item quantities.<br>4. In `whatsappIntentService.ts`, `trackMedicineRequest` had an inverted check (`filterResult.matches.length === 0 || confidence < 80`) which auto-created a `special_orders` row whenever a string had low confidence or no local match, saving raw promotional text into the database without requiring order intent or verified catalog presence. |
| **How it was fixed** | 1. Implemented `isPromotionalOrBroadcastMessage()` in `src/services/intentKeywords.ts` detecting marketing headlines, deals, margins, cashbacks, points, schemes, promotional emojis, and broadcasts, dropping them immediately in `handleInbound` and `handleOcrComplete`.<br>2. Hardened `isPlausibleMedicineName()`: strips all emojis and markdown formatting (`*`, `_`, `~`), filters non-numeric word tokens, and rejects any strings composed of noise/marketing words or commercial disqualifiers (`margins`, `ushop`, `cashback`, `dhamaka`, `webinar`, `deals`, `savings`, etc.).<br>3. Updated `extractMedicineCandidates()`: strips keycap emojis and list bullets before parsing to prevent misinterpreting bullet numbers as quantities, and returns empty for promotional messages.<br>4. Hardened `trackMedicineRequest()` in `src/services/whatsappIntentService.ts`: only creates a shortage special order when there is genuine order intent (`hasIntentWords || source === 'ocr'`), high confidence ($\ge 80\%$), confirmed master/catalog presence, and genuine out-of-stock shelf status. Passes the canonical matched medicine name instead of raw informal input.<br>5. Cancelled bogus pending special order rows (IDs 53 & 54) in the local database, clearing Quick Special Requests immediately. |
| **Priority** | P1 |
| **What not to touch** | Legitimate medicine intent keywords (`chahiye`, `bhej do`, `need`, `order`, etc.); OCR prescription scanning pipeline; multi-item candidate splitting (`extractMedicineCandidates`). |
| **Verified by** | `tests/whatsappPromoFilter.test.ts` (9/9 PASS); `tests/whatsappIntentGate.test.ts` (11/11 PASS); `tests/intentKeywords.test.ts` (20/20 PASS); `npx tsc --noEmit` PASS; `npm run guardrails` PASS; LocalAppData SQLite `special_orders` cleaned. |

### [Fixed] P1-21 — Live Cart Search Dropdown Priority Hardening: Strict Mapped Wall & Non-Mapped Relegation

| Field | Content |
|---|---|
| **What the user saw** | In the "Add to Live Cart" search dropdown list, non-mapped distributors with high stock or exact name matches appeared at the top above mapped distributors, causing confusion when attempting to add items directly to the live Pharmarack cart. |
| **Root cause** | `LiveCartAddModal.tsx` and `QuickOrderModal.tsx` evaluated query title proximity and Stock Tier at Steps 1 & 2 before Mapped vs Non-Mapped at Step 4. Consequently, an unmapped distributor with High Stock outranked a mapped distributor with Low or Out of Stock. |
| **How it was fixed** | 1. Enforced a strict **Mapped Wall** as Rule #1 across `LiveCartAddModal.tsx` and `QuickOrderModal.tsx`: mapped distributors are guaranteed to appear first, while non-mapped distributors are strictly relegated to the bottom.<br>2. Within mapped items, preserved exact title proximity (Rule #2), Stock Tier (High > Low > Out of Stock, Rule #3), and Active Live Cart presence (Rule #4, prioritizing distributors already added to the cart).<br>3. Expanded `tests/liveCartDropdownSorting.test.ts` with 3 new regression test cases verifying non-mapped items never outrank mapped items regardless of stock level or exact title match. |
| **Priority** | P1 |
| **What not to touch** | Direct OpenSearch API querying; active cart item aggregation (`activeCartMap`); background session restoration. |
| **Verified by** | `tests/liveCartDropdownSorting.test.ts` (9/9 PASS); `npm run guardrails` PASS; `node scripts/quick-update.mjs` synced. |

### [Fixed] P1-20 — Application Close Confirmation & Complete Shutdown of Frontend Window and Backend Server

| Field | Content |
|---|---|
| **What the user saw** | 1. Closing the app via window 'X' or Alt+F4 closed immediately without asking for confirmation, risking lost work.<br>2. Clicking "Exit App" in the sidebar stopped the backend, but the frontend window remained open displaying an orphaned black screen: *"AI PHARMACY OS SHUT DOWN — The backend process has terminated cleanly and port 5175 is free. You can safely close this browser window."* The window was not closed automatically. |
| **Root cause** | 1. Frontend lacked a `beforeunload` event listener to prompt for user confirmation before closing the window.<br>2. Browsers block script-initiated `window.close()` unless opened by script, leaving the dedicated Chrome `--app` window orphaned on screen.<br>3. Backend lacked tracking of the spawned desktop browser child process and did not terminate the app window process during clean exit. |
| **How it was fixed** | 1. Added a global `beforeunload` listener in `frontend/src/components/Layout.tsx` prompting for confirmation before closing the app window.<br>2. Replaced the basic inline prompt in `ExitAppButton` with a clean confirmation dialog and full-screen graceful shutdown overlay.<br>3. Tracked the spawned app window process (`activeAppBrowserProcess`) in `src/utils/chromeBrowser.ts` and added `closeAppBrowser()`.<br>4. Integrated `closeAppBrowser()` and re-entrancy mutex (`isShuttingDown`) into `src/server.ts` `gracefulShutdown`, cleanly terminating the frontend desktop window together with the backend. |
| **Priority** | P1 |
| **What not to touch** | Isolated app profile path (`data/app_browser_profile`); standard graceful shutdown sequence (backup, DB close, supervisor stop); port binding logic. |
| **Verified by** | Frontend build PASS (`tsc -b && vite build`); backend `npx tsc --noEmit` PASS; `npm run guardrails` PASS; `node scripts/quick-update.mjs` synced. |

### [Fixed] P1-19 — Rate, MRP, and Expiry Extraction Failure on Manual PC Invoice Uploads

| Field | Content |
|---|---|
| **What the user saw** | When uploading a manual purchase file from the PC (CSV, Excel `.xlsx`/`.xls`, Marg EDI), the Purchases page failed to populate `rate`, `mrp`, or `expiry_date` in the draft table, displaying `0` or empty values. |
| **Root cause** | 1. `isExcluded` for rate in `src/services/emailService.ts` explicitly excluded `/ptr/`, preventing common Indian pharma rate header `PTR` (Price To Retailer) from mapping to rate.<br>2. Expiry dates formatted with 3 parts (`DD/MM/YYYY`, `DD-MM-YYYY`), month names (`Dec-26`), ISO format (`2026-12-31`), raw digits, or Excel serial numbers either failed regex matching or inverted month/day into invalid dates.<br>3. Comma-separated numbers (`1,250.00`) or currency symbols (`Rs. 180.50`, `₹`) caused `parseFloat` to yield `NaN` or truncated values.<br>4. Header row offsets in distributor Excel/CSV files with top banner rows were skipped or misread.<br>5. Frontend intake lacked fallback backfill from the master medicine catalog for matched items with zero/missing rates or MRPs. |
| **How it was fixed** | 1. Removed `ptr`, `pts`, and `net` from rate exclusion rules and expanded header synonyms (`purrate`, `purchaserate`, `unitprice`, `basicrate`, `netrate`, `mrp`, `maxretailprice`, `srp`, `expdt`, `validity`, etc.).<br>2. Implemented universal expiry parser handling Excel serial dates, ISO dates, month names, 3-part dates, 2-part dates, and raw digits while filtering dummy values (`00000000`, `*`, `//*`).<br>3. Added `parseCleanNum` sanitizing commas and currency symbols.<br>4. Added dynamic header-row scanning (first 15 rows) and delimiter auto-detection (`,`, `;`, `\t`).<br>5. Synchronized frontend `formatExpiryToMMYY` and added automatic rate/MRP backfill from catalog when medicines match. |
| **Priority** | P1 |
| **What not to touch** | Direct file upload pipeline; OCR processing paths; keep-alive purchase state caching. |
| **Verified by** | Tested with real user CSV uploads and edge-case formats (`PTR & Exp 12/2026`, `Pur.Rate & ISO Date`, `Price & Month-Year`); `npm run guardrails` PASS; `frontend` build PASS; `node scripts/quick-update.mjs` synced. |

### [Fixed] P1-18 — Dytor 20 & Dytor 10 Packaging Image Cross-Connection & Strength Search Hardening

| Field | Content |
|---|---|
| **What the user saw** | 1. Dytor 20mg displayed or was linked with Dytor 10mg packaging images.<br>2. In Catalog Image Verification and POS details, Dytor 20mg showed blank blister plastic or 10mg candidate images, while Dytor 10mg showed Dytor E Combikit or Dytor Plus combo images.<br>3. Stray files named `dytor-20mg-tab-candidate-*.jpg` on disk were exact byte duplicates of Dytor 10mg. |
| **Root cause** | 1. `extractCoreBrand(raw)` in `src/services/catalogImageService.ts` stripped dosage strengths (`20MG`), reducing the online search query for `DYTOR 20MG TAB` to bare `"DYTOR"`. This returned mixed-strength results from PharmEasy containing Dytor 10, 20, 40, and Combikits.<br>2. `downloadNextCandidate()` accepted the first search product with an image without vetting whether its strength conflicted with the target medicine, downloading `dytor-10mg-side.jpg` as a `dytor-20mg-tab-candidate-*.jpg` file.<br>3. In `catalog_images`, Dytor 20mg primary (`is_primary = 1`) pointed to `dytor-20mg-front.jpg` (clear blister bubbles with no printed brand/strength text) while the genuine printed packaging foil with `Torsemide Tablets IP 20 mg` / `DYTOR-20` (`dytor-20mg-back.jpg`) was `is_primary = 0`.<br>4. Dytor 10mg had Combikit/Plus images set to `is_primary = 1`, hiding the authentic `dytor-10mg-side.jpg` (OCR verified `DYTOR-10 10mg`). |
| **How it was fixed** | 1. Updated `downloadNextCandidate()` and `searchCandidates()` in `src/services/catalogImageService.ts` to preserve extracted active strength in the search query (e.g. `"DYTOR 20MG"`).<br>2. Added mandatory pre-acceptance vetting in `downloadNextCandidate()` checking `matchCheck.signals.strengthConflict` and `brandMatch` before candidate selection.<br>3. Deleted all stray `dytor-20mg-tab-candidate-*.jpg` files from both `frontend/public/products/` and `uploads/products/`.<br>4. Updated `catalog_images` atomically: set `dytor-20mg-back.jpg` (OCR verified `DYTOR-20 20mg`) as `is_primary = 1` for all 20mg records (IDs 287067, 294248, 144279); set `dytor-10mg-side.jpg` (OCR verified `DYTOR-10 10mg`) as `is_primary = 1` for 10mg records (IDs 294291, 277966); deactivated and de-primaried all Combikit/Plus images attached to standard Dytor 10.<br>5. Also verified and set printed foil packaging as primary for Dytor 40mg and Dytor 5mg. |
| **Priority** | P1 |
| **What not to touch** | Multi-angle gallery storage; candidate search override flow; verification status lifecycle (`APPROVED`, `HIGH_CONFIDENCE`, `REPLACED`). |
| **Verified by** | `scripts/fix_dytor_catalog_images.mjs` (all Dytor records verified); `scripts/verify_disk_images.mjs` (10,821/10,821 valid, 0 missing, 0 zero-byte); `npm run guardrails` PASS; `node scripts/quick-update.mjs` synced. |

### [Fixed] P1-17 — AI Camera & Product Name Matcher Logic Errors Hardening

| Field | Content |
|---|---|
| **What the user saw** | 1. AI Camera scanning packaging like Dabur Honey or Himalaya Liv 52 matched wrong formulations from the same brand (e.g. Dabur Glucose D or Himalaya Cystone).<br>2. OCR scanning Vicks Vaporub matched Vicks Inhaler or Cough Drops due to shared brand token.<br>3. Blister pack count (e.g. 10 tablets) masked active dosage strength differences (e.g. 500mg vs 250mg) due to naive digit matching.<br>4. Camera OCR scanning promotional packaging (e.g. 'FREE 50g HONEY WITH THIS PACK') extracted the promotional gift instead of the actual medicine.<br>5. Clinical dosage form conflicts (e.g. Tablet vs Syrup) were weakly dampened rather than rejected. |
| **Root cause** | 1. `enhancedSimilarity` in `src/services/productNameFilterService.ts` used global Levenshtein/n-gram without umbrella formulation disambiguation (`Dabur`, `Himalaya`, `Patanjali`, etc.).<br>2. Naive digit regex (`\d+`) matched pack counts against active strengths without checking units ($mg$ vs $ml$ vs tablets).<br>3. Modality conflicts between topical balms, oral lozenges, and nasal inhalers were unconstrained.<br>4. Unbounded prefix matching (`startsWith()`) artificially boosted 3-4 letter medical stems like `derma` against `dermatouch` with 92% similarity.<br>5. `aiCameraService` lacked promotional banner suppression in candidate extraction and fallback brand selection. |
| **How it was fixed** | 1. Implemented `extractUmbrellaFormulation()` penalizing conflicting formulations under umbrella brands to $\le 0.20$.<br>2. Added unit-aware `extractDrugStrength()` ($mg, mcg, iu, \%$) and `extractVolumeOrWeight()` ($ml, gm, g$); conflicting active strengths are penalized $-0.35$.<br>3. Implemented `isModalityConflict()` barring cross-matching between balms, inhalers, and lozenges ($\le 0.20$).<br>4. Bounded prefix matching requiring whole-word token boundary verification.<br>5. Implemented `isItemTypeConflicting()` in `productNameFilterService.ts` applying a $-0.40$ clinical conflict penalty in FTS5 and candidate filtering.<br>6. Expanded `detectDosageForm()` in `aiCameraService.ts` for `Balm`, `Soap`, `Oil`, `Shampoo`, `Serum`, `Powder`, `Sachet`, and `Respules`.<br>7. Added promo banner suppression in `aiCameraService.ts` candidate line extraction and fallback brand selection. |
| **Priority** | P1 |
| **What not to touch** | `filterProductNames()` external interface and response signature; cached OCR corrections in SQLite; camera offline Tesseract/ONNX fallback paths. |
| **Verified by** | `scripts/test_aicamera_improvements.ts` (17/17 PASS); `tests/services/productNameFilterService.test.ts` (7/7 PASS); `tests/catalogImageVerification.test.ts` (13/13 PASS); `tests/aiCamera.test.ts` (4/4 PASS); `npm run guardrails` PASS; `node scripts/quick-update.mjs` synced. |

### [Fixed] P1-16 — Master Catalog Image AI Verification Hardening & Complete 100% Download & Attachment (Skip=0, Not Found=0)

| Field | Content |
|---|---|
| **What the user saw** | 1. 534 medicines in the master database lacked verified active images (`skip product > 0`, `not found > 0`).<br>2. Some local images previously downloaded had misleading promo packs (e.g. Softovac with a small 'Free Dabur Honey' banner attached to Dabur Honey; 50ml catheter syringe attached to 10ml Dispovan).<br>3. User requested complete re-verification, cross-check, downloading, and attaching genuine product images with zero wrong images and 100% coverage. |
| **Root cause** | 1. Local filenames could not be blindly trusted because an earlier script named files after the local query rather than the candidate image.<br>2. Multi-signal verification engine lacked umbrella brand formulation disambiguation (e.g. `BAIDYANATH`, `DABUR`, `HIMALAYA`, `PATANJALI`, `ZANDU`), packaging container vs medical dosage form separation (`STRIP`/`BOTTLE` vs `TABLET`/`SYRUP`), numeric chemist MRP code stripping, and bidirectional topical balm vs oral lozenge/inhaler guards.<br>3. PharmEasy CloudFront CDN Lambda@Edge threw 503 when query parameters were stripped (`url.split('?')[0]`). |
| **How it was fixed** | 1. Hardened `src/services/catalogImageService.ts` with formulation word extraction for umbrella brands, separated `PACKAGING_CONTAINERS` from `DOSAGE_FORMS`, added numeric MRP stripping, and added topical/inhaler guards.<br>2. Integrated direct Apollo 24\|7 official manufacturer CDN links for Dabur Honey variants.<br>3. Downloaded and verified authentic high-resolution references for all core commodity lines (Himalaya Baby line, Parachute pure coconut oils, Bajaj Almond drops, Dabur classicals, Vicks balms/drops, Moov/Iodex/Zandu/Tiger balms, Whisper sanitary pads, Pampers diapers, Dispovan sterile syringes).<br>4. Executed automated resolution engines (`scripts/resolve_master_catalog.mjs`, `scripts/resolve_all_final.mjs`, `scripts/resolve_final_135.mjs`) resolving all 534 unattached medicines down to 0.<br>5. Performed full disk audit confirming all 10,852 active images exist in both `frontend/public/products` and `uploads/products` (0 missing, 0 zero-byte). |
| **Priority** | P1 |
| **What not to touch** | Public image gate (`verification_status IN ('APPROVED', 'HIGH_CONFIDENCE')` and `is_active = 1`); existing 10,318 verified images; image review history audit trail. |
| **Verified by** | `tests/catalogImageVerification.test.ts` (13/13 PASS); `scripts/verify_disk_images.mjs` (10,852/10,852 valid on disk, 0 missing, 0 unresolved); `npm run guardrails` PASS; `node scripts/quick-update.mjs` synced. |



### [Fixed] P1-15 — Distributor messages sent twice / duplicate distributor order & reminder dispatches when order already sent or generated

| Field | Content |
|---|---|
| **What the user saw** | In the installed app, sometimes the same message is sent to the distributor twice if the order was already sent, or if the app generated the message twice. |
| **Root cause** | Compounding gaps across 5 trigger points: (1) In `handleSendWhatsAppOrder` (`PharmarackCart/index.tsx`), single order send called `POST /messaging/send` and then called `POST /pharmarack/cart/notify-manual` with default `targetMode = 'both'` to notify delivery boys, but `notify-manual` called `notifyDistributorCartOrder()` which formatted and enqueued a SECOND message to the distributor. String differences caused exact dedupe to miss. (2) Empty-cart transition auto-notifications in `routes/pharmarack.ts` lacked same-day order check, re-sending orders already sent from the UI. (3) Auto reminder worker in `distributorDispatchReminderWorker.ts` queried `WHERE r.status != 'No Order Today'`, which included `Dispatched` (e.g. distributor already sent invoice by email) and `Collected`, causing reminders to be sent to distributors who had already dispatched. (4) Inline phone edits on Dispatch table triggered an immediate reminder send even on completed/reminded rows. (5) `whatsapp_send_queue` only matched exact string equality, allowing near-duplicate order sends. |
| **How it was fixed** | 1. Added `skipDistributor: true` option in `notifyDistributorCartOrder` and `POST /pharmarack/cart/notify-manual`; `handleSendWhatsAppOrder` now passes `skipDistributor: true` so the distributor is only messaged once while delivery boys are recorded for batch dispatch.<br>2. Added same-day order deduplication in `notifyDistributorCartOrder` suppressing duplicate sends within 2 hours or same day.<br>3. Changed reminder worker queries and `sendDistributorDispatchReminder` to strictly gate on `status = 'Pending'`, completely skipping already `Dispatched` or `Collected` orders.<br>4. Guarded Dispatch table phone edits to only auto-send if status is `Pending` and not yet reminded today.<br>5. Added 15-minute duplicate guard in `whatsappQueueWorker.enqueue` for distributor orders and deduplicated identical same-day batch orders in `whatsappQueue.ts`. |
| **Priority** | P1 |
| **What not to touch** | Safe anti-ban pacing rules (10-15s); single-flight processor lock; delivery boy daily batch dispatch mechanism. |
| **Verified by** | `tests/distributorNotification.test.ts` (9/9 PASS); backend `npx tsc --noEmit` clean; frontend build clean; `npm run guardrails` PASS. |

### [Fixed] P1-14 — Customer past bills failed to load and WhatsApp OTP login was blocked for unprovisioned users

| Field | Content |
|---|---|
| **What the user saw** | 1. Customer logged in via WhatsApp OTP but past bills were always empty.<br>2. Users attempting WhatsApp OTP login without prior manual account generation in CRM received 404 "Refill account not found or disabled".<br>3. Disconnected customer identity risking separate data pools between web and mobile clients. |
| **Root cause** | 1. `GET /customer/bills` in `src/routes/customerPortal.ts` queried `FROM sales s` and `WHERE si.sale_id = ?`, which failed on SQLite runtime (the actual tables are `sales_invoices si` with `si.invoice_no` and `sale_items sit` with `sit.invoice_id`). Errors were caught silently by `.catch(() => [])`.<br>2. `POST /auth/request-otp` rejected any phone number not pre-provisioned in `customer_portal_accounts`.<br>3. Lack of permanent session token verification allowed arbitrary `customer_id` parameter sniffing. |
| **How it was fixed** | 1. Rewrote `GET /customer/bills` to query `sales_invoices` and `sale_items` joining `inventory_master` and `medicines`, returning historical snapshots (`unit_price`, `quantity`, `total_price`).<br>2. Updated `POST /auth/request-otp` and `/auth/verify-otp` to auto-provision `customers` and `customer_portal_accounts` bound to permanent `customer_id`.<br>3. Implemented HMAC-SHA256 session token generation and tenant isolation checks (`verifyCustomerToken`) preventing cross-customer access (403 Forbidden).<br>4. Added `PUT /customer/phone` preserving immutable `customer_id` across phone updates and idempotency protection in `POST /customer/refill-order`. |
| **Priority** | P1 |
| **What not to touch** | POS billing transactions; immutable `sales_invoices.id`; patient refill schedule calculations. |
| **Verified by** | `tests/whatsappOtpIdentity.test.ts` (11/11 PASS); `tests/customerPortalLifecycle.test.ts` (8/8 PASS); `npm run guardrails` PASS. |

### [Fixed] P1-13 — WhatsApp send stalled on sleeping/installed client; missing email inbox deletion; unwanted message send persistence

| Field | Content |
|---|---|
| **What the user saw** | 1. In installed builds, creating a Special Request failed to send WhatsApp messages until the entire app was restarted or manual reconnect clicked.<br>2. Deleting an email was not possible from the local inbox.<br>3. When user turned WhatsApp Alert OFF in Special Order modal, the toggle auto-reset to ON every time and attempted sending unwanted messages. |
| **Root cause** | 1. `launchClientInstance` lacked `process.env.LOCALAPPDATA` Chrome paths for per-user installations in production, and `whatsappQueueWorker.enqueue` didn't auto-wake sleeping clients when enqueuing immediate messages.<br>2. No `DELETE /api/email/:uid` backend route or UI delete button existed for local inbox rows.<br>3. `QuickOrderModal` and `CRM` reset `sendWhatsApp(true)` unconditionally rather than persisting the user's toggle preference in `localStorage`. |
| **How it was fixed** | 1. Added `LOCALAPPDATA` and `PROGRAMFILES` paths to `whatsappClient.ts` Chrome launcher, and added proactive silent wake-up on immediate `enqueue()` in `whatsappQueueWorker.ts`.<br>2. Added `deleteEmail(uid)` in `emailService.ts`, `DELETE /api/email/:uid` in `routes/email.ts`, `api.deleteEmail` in `frontend/src/services/api.ts`, and delete actions with cache-synchronization in `frontend/src/pages/Mail/index.tsx`.<br>3. Persisted `sendWhatsApp` state in `localStorage` in `QuickOrderModal.tsx` and `CRM/index.tsx` so turning OFF WhatsApp is remembered and not overwritten on reset.<br>4. Updated `deleteItem()` in `whatsappQueueWorker.ts` to cascade delete linked notification rows and broadcast SSE events. |
| **Priority** | P1 |
| **What not to touch** | Saved session credentials preservation in `.wwebjs_auth`; anti-ban pacing rules; single-flight mutex. |
| **Verified by** | `npm run build` (0 errors); `npm --prefix frontend run build` (0 errors); `npm run guardrails` PASS; `node scripts/quick-update.mjs` synced. |

### [Fixed] P2-12 — WhatsApp Automation Hub popover showed blocking "Loading automation details..." spinner on open due to missing SWR module cache

| Field | Content |
|---|---|
| **What the user saw** | Clicking the WhatsApp Automation Hub button in the topbar sometimes took time to open and displayed a blocking "Loading automation details..." message instead of rendering instantly. |
| **Root cause** | `AutomationHubPopover` unmounted completely on close and started with `loading = true`, forcing two asynchronous SQLite roundtrips (`/catalog` and `/hub-summary`) before rendering any switches or activity history. When SQLite was busy with POS/sync queries, opening the hub lagged by 200ms–800ms. |
| **How it was fixed** | 1. Implemented module-level SWR (Stale-While-Revalidate) caching in `frontend/src/components/AutomationHubPopover.tsx` so the popover opens in 0ms using cached state and updates silently.<br>2. Added `prefetchAutomationHub()` on hover (`onMouseEnter`) to pre-warm cache.<br>3. Updated `handleToggle`, `handleResolve`, and `handleResolveAll` to synchronize module cache optimistically.<br>4. Fixed `handleAutomationHubClose` in `Layout.tsx` to prevent falsely wiping failure headline badges on close. |
| **Priority** | P2 |
| **What not to touch** | Single SSE subscription flow; `api.getAutomationCatalog` and `api.getAutomationHubSummary` contracts. |
| **Verified by** | TypeScript compile check; `npm run guardrails` PASS; quick-update synced. |

### [Fixed] P1-11 — WhatsApp queue premature exit: newly enqueued items remained pending indefinitely after 1st send

| Field | Content |
|-------|---------|
| **What the user saw** | When batch-triggering WhatsApp messages (e.g. marking 4+ special orders ready), only the 1st message was dispatched. Subsequent messages (e.g. #2, #3, #4) remained in `pending` queue with yellow header badge and did not send until manual intervention or 15-minute idle wake. |
| **Root cause** | In `src/services/whatsappQueueWorker.ts`, `processQueueInternal()` fetched a single snapshot array of due items on entry and used a fixed `for (let i = 0; i < pendingItems.length; i++)` loop. Subsequent messages enqueued while message #1 was sending were ignored by `triggerProcessing()` (due to single-flight mutex). When message #1 finished, the loop terminated without re-querying the database for newly arrived items. Furthermore, `startWorkerLoop()` entered a 15-minute idle delay even when pending items existed. In `src/routes/automation.ts`, `activeSendingRow` selected the newest item rather than the oldest/currently sending item. |
| **How it was fixed** | 1. Refactored `processQueueInternal()` to dynamic `while (true)` draining loop that queries the database for the oldest pending item on each iteration until all due items are sent.<br>2. Updated `startWorkerLoop()` to check pending item count before sleeping 15 minutes in idle state.<br>3. Updated `src/routes/automation.ts` to pick sending/oldest pending item for accurate UI reflection. |
| **Priority** | P1 |
| **What not to touch** | Safe 10-15s anti-ban pacing between sends; single-flight lock; session persistence. |
| **Verified by** | Live flush test drained all 3 pending items (301, 302, 303) successfully with ~12s pacing; `npm run guardrails` PASS; quick-update synced. |

### [Fixed] P1-10 — Batch create special orders failed: `table special_orders has no column named notification_count`

| Field | Content |
|-------|---------|
| **What the user saw** | Order creation errored: `Batch create special orders error: [Error: SQLITE_ERROR: table special_orders has no column named notification_count]` on `POST /api/orders/batch` and `POST /api/orders`. |
| **Root cause** | `CURRENT_SCHEMA_VERSION` was at `43`, and fast boot skipped DDL when version matched. In `src/database.ts`, `columnMigrations` array lacked entries for `notification_count` and `cart_add_error`, so databases upgraded to schema v43 never had those columns added to `special_orders`. Also `initOrdersTable` in `src/routes/orders.ts` was a no-op that didn't heal missing columns. |
| **How it was fixed** | 1. Bumped `CURRENT_SCHEMA_VERSION` to `44` in `src/database.ts`.<br>2. Added `notification_count` and `cart_add_error` to `columnMigrations`, `CREATE TABLE special_orders_new`, and `CREATE TABLE IF NOT EXISTS special_orders`.<br>3. Made `initOrdersTable(db)` in `src/routes/orders.ts` check and dynamically add missing columns (`notification_count`, `cart_add_error`) on demand.<br>4. Updated `tests/ordersNotifiedFlag.test.ts` to assert `notification_count: 0` and verify booking notification flow. |
| **Priority** | P1 |
| **What not to touch** | `notified` flag starts at `0` on order booking because it tracks customer arrival notification (on Mark Ready); booking notification is recorded in `automation_notifications`. |
| **Verified by** | `tests/ordersNotifiedFlag.test.ts` + `tests/specialOrderArrival.test.ts` (13/13 PASS); `npm run build` clean; `npm run guardrails` PASS. |

### [Fixed] S-01 — Single-key settings endpoints stored `admin_password` as plaintext (hashing only existed on the bulk `/save` path)

| Field | Content |
|-------|---------|
| **What the user saw** | Nothing directly — found during the 2026-08-25 security/settings audit. `POST /settings/save` (the path the Settings UI uses) PBKDF2-hashes `admin_password`, but the sibling single-key endpoints `POST /settings/` and `POST /settings/save-single` wrote whatever they received verbatim, so any future/alternate caller would silently store a plaintext password (login kept working via `verifyPassword`'s legacy plaintext fallback, masking the mistake). |
| **Root cause** | The hashing guard added to the bulk save was never mirrored onto the two single-key upsert handlers in `src/routes/settings.ts`. |
| **How it was fixed** | Both handlers now apply the identical guard: if `key === 'admin_password'` and the value is non-empty and not already `pbkdf2:`, it is hashed with the shared `hashPassword` before the upsert. No API shape change; already-hashed values pass through untouched. |
| **Priority** | P2 (defense-in-depth; server binds 127.0.0.1 so remote exposure is nil) |
| **What not to touch** | `verifyPassword`'s legacy plaintext fallback must stay until a one-shot migration hashes existing rows — removing it now could lock out owners whose password predates hashing. Do not "mask secrets" in `GET /api/settings` without an owner decision: the Settings page pre-fills integration fields from it. |
| **Verified by** | `npm run build` clean; `npm run guardrails` PASS; knowledge graph updated. |

### [Fixed] P1-09 — Catalog pipeline crashed on every install: `catalog_jobs` table missing 12 columns the worker/routes require

| Field | Content |
|-------|---------|
| **What the user saw** | Any catalog upload/OCR/review flow hit `SQLITE_ERROR: no such column: original_filename / mapping_config / matched_previous_job_id …`; job analysis flipped to `failed`. Present on fresh test DBs AND the long-lived live dev database. Surfaced by catalogPipeline/duplicateCatalog suites during the 2026-08-25 all-tests sweep. |
| **Root cause** | `CREATE TABLE catalog_jobs` (database.ts) predates the OCR pipeline and only defines id/file_path/status/created_at, while `catalogWorker.ts` + `routes/catalog.ts` read/write 12 more columns (original_filename, extracted_data, mapping_config, data_filters, error_log, progress, total_count, processed_count, new_count, existing_count, duplicate_count, matched_previous_job_id, newly_detected_columns). Same silent-missing-columns class as the earlier stock_ledger bug. |
| **How it was fixed** | All 12 columns added to the declarative guarded-ALTER list in `ensureSchema` (PRAGMA pre-checked, idempotent every boot) — fixes fresh installs AND upgrades existing databases with zero migration step. Verified by catalogPipeline (4/4) + duplicateCatalog (2/2) suites passing. |
| **Priority** | P1 |
| **What not to touch** | New catalog_jobs columns MUST be added to the alterStatements list, not just the CREATE block — installs upgrade in place. Never reference a new column in worker/route SQL without registering it there. |
| **Verified by** | Full suite: 72/72 suites, 433/433 tests PASS parallel; `npm run build` clean; guardrails PASS. |

### [Fixed] P2-08 — Corrupt/wrong phone numbers in special_orders (`@c.us@c.us` suffixes; arrival WhatsApp going to the wrong customer)

| Field | Content |
|-------|---------|
| **What the user saw** | Walk-in WhatsApp orders stored phones like `9198XXXXXXXX@c.us@c.us`; order #36 ("CUSTOMER 98XXXXXXXX") carried ANOTHER customer's number, so its arrival messages were queued to the store phone. |
| **Root cause** | Three unclean write paths: `whatsappIntentService` copied chat-id-style phones into shortage requests, `shortageReminderService.createSpecialOrderFromShortage` inserted `customer_phone` raw into `special_orders.phone`, and `PUT /api/orders/:id` stored client-supplied phones without the digit-cleaning its sibling POST routes already had. |
| **How it was fixed** | All three sites now normalize to digits-only (suffixes/formatting stripped; missing stays missing). One-shot idempotent `scripts/normalizeSpecialOrderPhones.mjs` cleans existing rows and extracts a 10-digit number embedded in the requester name when it contradicts the stored value (fixed #36); empty stays empty, nothing invented, `--dry-run` supported. Run once 2026-08-25: 5 rows fixed, re-run reports 0 changes. |
| **Priority** | P2 |
| **What not to touch** | Never "invent" a phone for empty rows; the name-extraction only fires on EXACTLY one 10-digit run in the name. Don't add boot-time auto-migration (owner chose one-shot script). |
| **Verified by** | Dry-run → real run → idempotency check (second dry-run: 0 changes); live DB query shows 0 remaining non-digit phones incl. #26/#36/#44/#57/#58 corrected; `npm run build` clean; guardrails PASS. |

### [Fixed] P1-08 — "Mark Ready" from the CRM edit modal / status buttons silently skipped the customer's arrival WhatsApp

| Field | Content |
|-------|---------|
| **What the user saw** | User clicked Mark Ready for a customer's order; order showed Ready but the customer never received the arrival WhatsApp (observed 2026-08-25). No error toast — pure silent miss. |
| **Root cause** | Two click-paths mark orders Ready: Quick Assist uses `POST /orders/:id/status` which queues the arrival WhatsApp via `enqueueArrivalWhatsApp`, but the CRM Special-Orders panel (`frontend/src/pages/CRM/index.tsx` handleUpdateStatus + edit-modal save) calls the generic `PUT /api/orders/:id`, and that backend route saved status WITHOUT any WhatsApp logic. Also, when queueing failed server-side (e.g. boot window ~04:54 with client offline), the error was console-only. |
| **How it was fixed** | `PUT /orders/:id` now runs the SAME idempotent helper when status becomes Ready and `notified !== 1` (same try/catch isolation), sets `notified=1` only on success, and returns `whatsapp_queued`. CRM handlers toast truthfully from that field ("arrival WhatsApp queued" vs "no arrival WhatsApp queued") per the existing Quick Assist toast contract. One send per order is preserved across ALL paths via the notified flag. |
| **Priority** | P1 |
| **What not to touch** | Do not bypass `enqueueArrivalWhatsApp` or reintroduce a second enqueue site; do NOT auto-dispatch from workers (Strict Manual-Only Patient Messaging Contract stands — this is still inside the user-clicked request). |
| **Verified by** | `tests/specialOrderArrival.test.ts` + `tests/ordersNotifiedFlag.test.ts` 13/13 PASS; `npm run build` clean; guardrails PASS. |

### [Fixed] P2-07 — Resend button on failed-message cards errored "Queue item not found"

| Field | Content |
|-------|---------|
| **What the user saw** | A permanently-failed customer message shown from the failure log (card id ≥ 900000) could never be re-sent from the WhatsApp Queue popover — clicking Resend returned "Queue item not found". |
| **Root cause** | `getWorkerState()` merges `automation_notifications` rows into the list as id `900000 + n.id` (and direct outbound messages as `800000 + hash`), but `POST /whatsapp/queue/items/:id/resend` only looked up `whatsapp_send_queue`, so mapped rows always 404'd. |
| **How it was fixed** | The resend endpoint resolves its source in order: (1) real `whatsapp_send_queue` row, (2) `automation_notifications` row via `id − 900000`, (3) explicit `{number,message,targetName}` payload passed by the popover for hash-mapped direct rows. Phone normalized + ≥10-digit validated with an actionable error, message-presence checked, enqueued with `skipDedupe` + `forceNext` as before. |
| **Priority** | P2 |
| **What not to touch** | Keep `skipDedupe: true` — resends must never be suppressed by same-day dedupe. Failure-log rows are left as-is (they truthfully document the failure); the resend creates a NEW queue item. |
| **Verified by** | Manual API-shape review; `npm run build` clean; frontend eslint/tsc clean; guardrails PASS. |

### [Fixed] P3-08 — Received WhatsApp voice notes could not be deleted from the inbox

| Field | Content |
|-------|---------|
| **What the user saw** | Voice notes (type `ptt`/`audio`) customers sent rendered as a generic "📁 Media Attachment" with a pointless OCR-scan button and no way to remove them. |
| **Root cause** | No delete route existed for single `whatsapp_messages` rows (only bulk-by-chat cleanup inside toggle-ignore), and the chat bubble renderer never inspected `message.type`. |
| **How it was fixed** | New `DELETE /messaging/chats/:chatId/messages/:messageId` (messaging.ts owns the inbox surface): removes the LOCAL cached row + best-effort media files (`data/inbound_media/<safeId>.jpg`, `<appData>/uploads/<msgId>*`) using the writers' exact sanitization; NEVER touches the sender's own WhatsApp copy. Frontend: received voice notes show a 🎤 label, no OCR button, and a trash affordance that deletes then filters local state with a truthful toast. |
| **Priority** | P3 |
| **What not to touch** | Deletion stays local-cache-only and user-clicked; do not attempt remote revoke/unsend via whatsapp-web.js. OCR scan button remains for image media only. |
| **Verified by** | Route follows existing messaging.ts conventions; frontend tsc/eslint clean; guardrails PASS. |

### [Fixed] P3-09 — Remaining raw solid backgrounds broke Day mode; dead `.light` shim layer retired

| Field | Content |
|-------|---------|
| **What the user saw** | Scattered opaque surfaces ignored the theme: Purchases upload/distributor modals (gray-800/900 islands with white-on-neutral text), HoverPriceIntel popovers (bg-gray-900), BackupCenterModal zinc-800 buttons, Dispatch avatar chip + toggle track (zinc-800/700), CatalogUpload mapping modal forcing bg-zinc-950 over its own glass token, PhoneSales timeline node (zinc-600), plus sticky table headers/floating widgets/drawers painted raw `#18181b`/`#121214`. Several had NO light-mode shim at all (zinc-800/600). |
| **How it was fixed** | Whole-app sweep: every raw solid swapped to semantic tokens (`bg-bg2/bg-bg3/glass-bg`, `text-text/text-muted`, `border-border`; accent fills keep `text-white` per the P2-05 exception; camera stage/QR tiles/print DOM untouched). Sources fixed at origin, then the now-dead `.light` gray/zinc/hex shim blocks were verified-unused (0 hits) and deleted from index.css. Toggle knobs/dots (micro-elements) deliberately left. |
| **Priority** | P3 |
| **What not to touch** | Sanctioned solids stay: AICamera video stage, QR/barcode white tiles, print portal whites, opacity scrims. Never reintroduce bare `bg-white/bg-black/bg-gray-*/bg-zinc-*/bg-[#hex]` surfaces; new surfaces use semantic tokens only (guardrail F6 watches changed lines). |
| **Verified by** | Repo-wide grep: 0 remaining raw palette sites; frontend tsc + eslint clean; `npm run guardrails` PASS; knowledge graph updated. |

### [Fixed] P2-06 — Mail-arrival WhatsApp alerts showed sync time instead of mailbox arrival time, omitted Bill Amount, and printed raw mail ID instead of distributor name

| Field | Content |
|-------|---------|
| **What the user saw** | A distributor mail arriving 7 AM but synced 10 AM produced an alert saying `Arrival Time: 10 AM`; order alerts often had no `Bill Amount:` line at all; and unresolved senders were displayed as a bare mail address (`billing@xyz.com`) even when that mail ID was already saved on the distributor profile in the AI Learning page. |
| **Root cause** | `emailService.ts` delta-sync built the processed mail WITHOUT its date field, so `extractOrderInfo` fell back to `new Date()` (sync moment) for `timeStr`, and `notifyMailArrival` preferred that over the correct `parsedDate`. Bill Amount was appended only when subject/body regex matched — amounts living solely inside CSV/TXT attachments were invisible. Distributor resolution compared `distributors.email` with raw SQL equality only (display-formatted or multi-address entries never matched), then fell through to a legacy hardcoded keyword list (`'nitin'→'Nitin Agency'` etc.) and finally to the raw sender string; no learning back of observed mail IDs. |
| **How it was fixed** | Delta-sync now carries the REAL arrival timestamp (IMAP INTERNALDATE preferred, sender Date header fallback) and all three alert surfaces (owner WhatsApp alert, in-app SSE toast, `sendDistributorWhatsAppAlert`) prefer it — sync time is last-resort only. Billing amount extraction reuses one shared pattern (`extractBillAmount`) over subject+body AND text attachments (CSV/TXT ≤100 KB); order alerts ALWAYS print `Bill Amount:` with honest `N/A` when undetectable (never invented). Resolver rewritten: priority 1 = clean-vs-clean email compare (`extractCleanEmail` both sides, handles `"Name <a@b.c>"` / multi-address storage); priority 2 = exact display-name match which LEARNS BACK the sender mail ID onto `distributors.email` (append-only, idempotent) so AI Learning layouts link permanently. Hardcoded keyword list deleted per owner decision. |
| **Priority** | P2 |
| **What not to touch** | Never reintroduce hardcoded sender-keyword→distributor-name mappings in `extractOrderInfo`. Learn-back must stay append-only and only fire on exact display-name match (no fuzzy distributor linking). `Bill Amount: N/A` is intentional truthful reporting — do not hide the line or fabricate totals from item rows. INTERNALDATE stays the preferred timestamp source (it IS "arrived in box"). |
| **Verified by** | `tests/email_notifications.test.ts` 7/7 PASS (real-timestamp precedence, attachment amount extraction, N/A line, dirty-format resolution, learn-back merge/idempotency); adjacent suites `emailDistributorIntegrity` + `distributorSanitization` PASS; `emailPurchase*` failures confirmed identical on stashed baseline (pre-existing, unrelated); `npx tsc --noEmit` zero errors repo-wide; `npm run guardrails` PASS. |

### [Fixed] P2-05 — Day-mode text invisible on colored buttons ("font and background same colour"); secondary text too pale

| Field | Content |
|-------|---------|
| **What the user saw** | In the Day (light) theme, several buttons/chips showed label text in nearly the same colour as their fill (green-on-green / green-on-blue), e.g. POS "+ Add"/"Import & Add" hover chips, AI Camera Scan, Save & Print, Doctor/Patient save buttons, Settings Pharmarack login, Mail process button, PurchaseHistory/Sells print-label buttons, 404 "Return to Dashboard". Secondary (`text-muted`) copy also looked washed out. |
| **Root cause** | 12 elements placed the semantic body-text token `text-text` on top of saturated accent fills (`bg-primary`, `bg-sky`, `bg-green`, gradient `from-primary to-teal-500`, incl. hover-fill states). In Dark mode `--text` is near-white so it read fine; when the Day palette shipped it became deep green `#14532d`, landing same-hue on `#22c55e`/`#0ea5e9` fills. Separately, light `--muted` `#5b7a68` gives only ≈3.7:1 contrast on mint/white (< WCAG AA 4.5:1). |
| **How it was fixed** | All 12 spots switched to `text-white` / `hover:text-white` / `group-hover:text-white` — the pattern `index.css` already exempts from its `.light .text-white` override for elements carrying an accent bg class (CRM filter chip was already correct; used as reference). Files: App.tsx, POS/index.tsx (8 spots), Mail, PurchaseHistory (2), Sells, Settings, PharmarackCart. Light `--muted` darkened `#5b7a68` → `#44604f` (≥5:1 on mint/white). Dark mode unchanged visually (white ≈ prior near-white). |
| **Priority** | P2 |
| **What not to touch** | The `index.css` exemption list on `.light .text-white:not([class*="bg-primary"])…` is what keeps these labels white in Day mode — never narrow it. Do not use `text-text` on solid accent fills anywhere; neutral surfaces only. |
| **Verified by** | Repo-wide grep shows zero remaining `text-text` on solid accent fills; guardrails PASS; no dark-mode white-on-white collisions found. |

### [Fixed] P2-04 — Investigation Center & Reports pages slow; Purchases dropdown showed duplicate medicines and hid saved batches

| Field | Content |
|-------|---------|
| **What the user saw** | (a) Investigation Center took seconds per page/scroll; (b) Reports tabs (esp. Non-Moving) hung for seconds AND stalled POS saves while loading; (c) Purchases medicine dropdown listed the same medicine name twice (18 legacy duplicate master-name pairs) and, after selecting one twin, Old Batches came up empty because history was saved under the other twin's id. |
| **Root cause** | Timeline route re-ran 4 unbounded SELECTs + loaded all 291k medicines + 37k inventory rows into JS Maps on EVERY request (even without adjustments), paginated LAST, used non-sargable `DATE(col)` predicates, double-sorted with `new Date()` in comparators, zero caching. Non-Moving ran its triple full scan inside `BEGIN IMMEDIATE` (held the DB write lock). Reports wrapped every date in COALESCE expressions no index could serve; expiry ignored `expiry_month`; exports recomputed Non-Moving. Batch lookup matched strictly by selected id with no sibling expansion. |
| **How it was fixed** | Investigation: filter-signature 60s TTL cache (pages 2..N = O(1) slices) invalidated by correction PUTs + write interceptor; lazy master loads; sargable range bounds (99.8ms -> 1.1ms measured); single sort via precomputed `_ts` + `.reverse()`. Non-Moving: plain read connection (no write lock), 5-min TTL shared by data+all 3 export handlers. Reports: expression indexes `idx_sales_report_day`/`idx_purchases_report_day` (12.8ms -> 0.3ms, EXPLAIN-verified), summary TTL cache, cutover clamp for missing from-date, product-trace prefix-first + parallel. New indexes on return_items(x2) + purchase_items(med,batch). Purchases: catalog-search collapses rows by normalized name (in-stock wins); `/purchases/medicine-batches` expands to sibling ids sharing the exact normalized name; frontend mirrors dedupe in `getMergedCatalog()`/response merge; row hover arms the same single-flight cached history load; seed list 30->150. |
| **Priority** | P2 |
| **What not to touch** | The 60s timeline / 5-min nonMoving / 60s summary cache invalidation wiring in `database/connection.ts`; expression indexes MUST track any future change to SALES_DATE_EXPR/PURCHASES_DATE_EXPR; sibling expansion in medicine-batches; PurchaseSaveVerificationModal as the only bill-commit path (no autosave introduced); UI-level duplicate hiding only — no DB merge of the 18 twin groups (owner decision). |
| **Verified by** | Backend `npx tsc --noEmit` clean; frontend build + eslint clean; `npm run guardrails` PASS; live A/B timings above with identical result counts (2583 rows both timeline variants); sibling expansion returns both twins [285906,285907] and their batches; EXPLAIN shows index seek. |

### [Fixed] P1-07 — Shared medicine photo fails to download ("could not download it after attempts")

| Field | Content |
|-------|---------|
| **What the user saw** | A customer-shared WhatsApp medicine image was not processed: `data/inbound_media` stayed empty and the admin escalation said the image could not be downloaded after repeated attempts. |
| **Root cause** | DB evidence (`whatsapp_messages` cache): every failing image came from an **@lid chat** and `downloadMedia()` threw whatsapp-web.js's minified internal `Error("r")` on EVERY attempt (v1.34.7) — event-emitted Message objects lose their media-decrypt context for LID-migrated accounts, so retrying the identical call could never succeed (inbound_media stayed empty; escalations fired 13:00 + 13:22 on 2026-08-24). A readiness gate (added first) was necessary but not sufficient. |
| **How it was fixed** | Three-step download ladder in `handleInbound`: (1) direct retries, (2) `msg.getChat()` store-hydration + retries, (3) NEW `downloadMessageMediaById(serializedId)` in `src/whatsappClient.ts` — a FRESH Message re-hydrated via `client.getMessageById()` whose `downloadMedia()` works even when the event object cannot. Per-attempt failures now log with real messages, and the owner escalation carries the full error chain (`direct: r \| hydrated: r \| ...`). Readiness gate from the first pass retained (60 s single-flight wait when not ready). |
| **Priority** | P1 |
| **What not to touch** | Idle-sleep evaluator/wake paths, boot T+45s auto-init, `downloadMediaWithRetry` signature/export (unit-tested), OCR queue flow, thumbnail endpoint. |
| **Verified by** | Backend `npx tsc --noEmit` clean; code-path review: no-ready arrivals now wait on single-flight restore instead of failing; escalation reason includes real error. |

### [Fixed] P2-03 — WhatsApp Live Queue Controller shows "Offline / Reconnecting" after restart / during idle sleep

| Field | Content |
|-------|---------|
| **What the user saw** | After closing and reopening the app (cold boot), the WhatsApp Live Queue Controller header showed "Offline / Reconnecting" as if the saved session had failed to reconnect — and it also flipped to that state whenever the app had been idle for a while. |
| **Root cause** | Truthful-status gap after the idle-sleep feature shipped: `getWhatsAppStatus()` exposes `sleeping` and `initializing`, but the queue worker's state payload (`src/services/whatsappQueueWorker.ts` getState) only surfaced `isOnline: waStatus.isReady`. The popover (`WhatsAppQueuePopover.tsx`) therefore rendered a binary chip: any non-ready moment — (a) the normal T+45s boot session-restore window, or (b) idle RAM-sleep after ~15 min (session intact on disk, auto-wakes on send) — was labeled "Offline / Reconnecting", falsely implying a broken reconnection. Boot auto-restore itself was working (`server.ts` T+45s `hasSavedSession()` → `initClient()`, profile-lock cleanup + 60 s silent retry already in place). |
| **How it was fixed** | Worker state now carries `sleeping` + `initializing`; `WhatsAppQueueStatus` interface extended; popover header derives a four-state connection chip — Online (green) · Sleeping · Auto-wakes on send (sky, moon icon; subtitle notes queued messages wake dispatch automatically) · Connecting… (sky, spinner) · Offline / Reconnecting (amber, only when genuinely neither ready/sleeping/connecting). No polling added; status still rides the existing queue-state fetch + SSE. |
| **Priority** | P2 |
| **What not to touch** | Idle-sleep evaluator/wake paths (demand-driven only), boot T+45s auto-init, profile-lock cleanup, queue worker pacing/dedupe semantics, Layout staged-notification card (uses isPaused, untouched). |
| **Verified by** | Backend `npx tsc --noEmit` clean; frontend `tsc --noEmit` + eslint clean on touched files; code-path review: sleeping/initializing flags flow worker→API→popover; no status poll can wake a sleeping client (contract intact). |

### [Fixed] P1-06 — Mobile app saves random/unwanted phantom bills on the PC after reconnect ("login")

| Field | Content |
|-------|---------|
| **What the user saw** | After opening/reconnecting the mobile app, unwanted "random" bills materialized on the PC (Sells history / staged Phone Sales) that nobody completed at the counter. |
| **Root cause** | Three compounding defects: (1) `createSale` in pharmacy-mobile/lib/api/sales.ts caught EVERY failure — including hard PC rejections like `API 400: Insufficient stock` — and queued the refused sale into `offline_sales_queue` anyway, deducting local stock, firing a WhatsApp fallback task, and returning a fabricated `TEMP-MOB-*` success invoice to the UI. On next reconnect the sync engine faithfully replayed those rejected bills onto the PC. (2) `POST /sales/sync` had zero idempotency: if the response was lost after the PC committed, the phone kept the queue and re-sent it → duplicate invoices. (3) The billing drawer's PENDING SYNC list offered no way to discard poisoned entries already stuck on the phone. |
| **How it was fixed** | Mobile `client.ts` now attaches `httpStatus` to thrown API errors; `createSale` re-throws all 4xx rejections immediately (real reason shown in Alert, nothing queued/fabricated) and keeps the offline path ONLY for network failures / 5xx ambiguity. Queued sales are stamped with a `client_ref` idempotency key; backend `/sales/sync` creates `sync_client_refs` table and skips already-seen refs inside the same transaction (replay-safe, rollback-safe). Billing drawer gained per-bill trash Discard + DISCARD ALL (with destructive confirm) so existing junk can be purged without syncing. |
| **Priority** | P1 |
| **What not to touch** | The offline-first queue design itself (NetInfo reconnect drain + 15s safety poll), admin direct-commit vs staged approval split in `/sales/sync`, WhatsApp fallback tasks for GENUINE offline sales, cart persistence contract. |
| **Verified by** | Backend `npx tsc --noEmit` clean; mobile `npx tsc --noEmit` clean; code-path review: 4xx now throws before any queue/local-stock/WA side effects; dedupe runs inside BEGIN/COMMIT so rolled-back batches leave no ref behind. |

### [Fixed] P1-05 — Printed/saved bill PDF is completely blank; saved filename always generic "AI PHARMACY OS"

| Field | Content |
|-------|---------|
| **What the user saw** | Clicking Print Bill (POS post-sale modal or Sells history view modal) and saving as PDF produced an empty `AI PHARMACY OS.pdf` with no invoice content, and the suggested filename never contained the patient name or invoice number. |
| **Root cause** | The `@media print` rules in frontend/src/index.css used the fragile visibility hack (`body * { visibility: hidden }` + absolute-positioned un-hide). The POS `#printable-bill` div lived INSIDE the modal card under a `fixed … backdrop-blur-md fade-in` overlay — backdrop-filter/transform ancestors change the abs-positioning containing block and overflow-hidden ancestors clip it, so nothing rendered on the printed page; printing while no printable div was mounted guaranteed a blank sheet too. Filename came from static `document.title` ("AI PHARMACY OS", frontend/index.html) which nothing updated before `window.print()`. |
| **How it was fixed** | New helper frontend/src/utils/printBill.ts (`printCurrentBill(fileNameBase)`): sanitizes and sets `document.title` (Chrome uses it as Save-as-PDF default), adds `printing-bill` class to `<body>`, prints, restores everything on `afterprint`. CSS rewritten to deterministic display-based hiding gated on that class: `body.printing-bill > *:not([data-print-root]) { display:none }` + `[data-print-root] { display:block; position:static }`. Both printable bills moved out of modal/page trees into their own `createPortal(…, document.body)` with `data-print-root` (POS/index.tsx, Sells/index.tsx). Print buttons now pass `Invoice-{no}-{patient}` (falls back to `Walk-in`). Side benefit: Compliance "Print Register" no longer prints blank (old CSS hid everything for it too); also fixed invalid `borderBottom: '1px border-dotted #ccc'` inline style on the POS bill row separator while relocating that block. |
| **Priority** | P1 |
| **What not to touch** | KeepAliveOutlet, SSE freshness mappings, barcode generation endpoints (server-side PDFs unaffected), Compliance page code, the pre-existing lint debt lines in POS/Sells (documented exempt in frontend/AGENTS.md). |
| **Verified by** | `tsc -b` clean after all edits; eslint on new util zero violations (POS/Sells pre-existing HEAD debt unchanged in kind — only relocated `(item: any)` line); portal structure confirmed via read-back (direct `<body>` children, correct JSX nesting). |

### [Fixed] P2-02 — POS cart scan thumbnails blank in list view; load only after minutes or on click/hover

| Field | Content |
|-------|---------|
| **What the user saw** | On the deployed website, AI-Camera scan thumbnails next to cart medicines rendered empty and only appeared minutes later (or instantly when opened/quick-viewed via the zoom modal). |
| **Root cause** | Two compounding issues: (1) `loading="lazy"` on the POS cart thumbnail `<img>`s (frontend/src/pages/POS/index.tsx) — the ONLY lazy images in the app. KeepAliveOutlet keeps every visited page mounted but hidden with `display:none`; Chromium never fetches lazy images inside hidden subtrees, so they loaded only on a later scroll/layout pass (minutes later). Base64 data URLs gain nothing from lazy loading anyway (no network request to defer). The zoom modal showed instantly because it had no `loading="lazy"`. (2) Deployed-site aggravators: legacy `frontend/public/sw.js` still shipped into `dist/` with a cache-first rule over every same-origin GET including `/uploads/*` images, while `main.tsx` unregistered workers WITHOUT clearing Cache Storage (`ai-pharmacy-v1`) — stale/poisoned entries served blanks then background-revalidated. Also `express.static(frontendDist, { maxAge: '1d' })` cached `index.html` for up to a day, so post-deploy clients could run a stale shell referencing pruned hashed chunks. |
| **How it was fixed** | Removed `loading="lazy"` from both cart thumbnail `<img>`s (kept `decoding="async"`). Deleted `frontend/public/sw.js` so it stops deploying; extended the main.tsx unregister block to also purge all Cache Storage entries (heals already-deployed clients). server.ts static mount + SPA fallback now send `Cache-Control: no-cache` for `.html` while hashed assets keep `immutable` 1-year caching. |
| **Priority** | P2 |
| **What not to touch** | KeepAliveOutlet display:none mechanism itself (binding SPA contract), zoom modal, hover-preview markup, `/uploads` static serving, AICamera capture pipeline (base64 size hardening deliberately deferred as YAGNI until quota errors are observed). |
| **Verified by** | Frontend build clean (`tsc -b && vite build`, 4.97 s); zero `loading="lazy"` remaining in frontend/src; rebuilt `dist/` contains NO `sw.js`; backend `tsc --noEmit` clean; eslint on touched files clean except pre-existing HEAD debt (POS 3893/3895 verified identical at HEAD); isolated Express harness replicating the exact static+fallback code paths against real `frontend/dist`: `/sw.js`→404, `/`→200 no-cache, `/pos`→200 no-cache, `/missing.png`→404 Asset not found, `/assets/*` chunk→immutable 1y. |

### [Fixed] P2-01 — Bulk expiry-return approval always fails with ReferenceError (`distributorId` undefined)

| Field | Content |
|-------|---------|
| **What the user saw** | `POST /api/returns/expiry-reviews/bulk-approve` returned 500 and rolled back whenever any selected review passed the stock check — bulk "Approve All" from the Expiry Return Review page could never complete. |
| **Root cause** | `bulk-approve` handler (src/routes/returns.ts) referenced an undeclared variable `distributorId` in its `INSERT INTO returns ... VALUES (?, 'purchase', ?, ?, ..., ?)` parameter list. TypeScript would flag it as `Cannot find name`, but the route file reached runtime via tsx without full type enforcement; at runtime it threw `ReferenceError: distributorId is not defined` inside the transaction, triggering ROLLBACK + generic 500. |
| **How it was fixed** | The loop now resolves the distributor explicitly via the same lazy lookup as single approve (latest purchase line for medicine_id+batch_no → distributor), uses that value for the return record, credit-note tracking (`trackExpiryReturn`) and persists it onto the review row. |
| **Priority** | P2 |
| **What not to touch** | Single-review `/expiry-reviews/:id/approve` flow unchanged beyond sharing the identical lazy-resolution query; scan deliberately stays join-free — distributor resolution belongs at approval time only. |
| **Verified by** | `tests/returnLossIntegrity.test.ts` test 6 (bulk-approve custom percentage → 200 + exact credit note) and `tests/expiryReturnReview.test.ts` test 5 both pass; backend `tsc --noEmit` clean. |

### [Fixed] P1-04 — Duplicate WhatsApp messages delivered (same queue item sent twice within seconds)

| Field | Content |
|-------|---------|
| **What the user saw** | Customers received identical WhatsApp messages twice within seconds: special-order arrival WA to shilpa chickne delivered 2× at 10:18:42 (two distinct real WhatsApp IDs, one queue item #185), and refill-collection WA to CHANDRAANT SUTAR delivered 2× at ~15:55 (confirmed visually on WhatsApp Web; outbox table only recorded one). Audit also found same-second double-sends for 3 email-arrival alerts and 1 distributor-invoice alert. |
| **Root cause** | Two races of the same class — guard state registered only AFTER an awaited operation completed: (1) `processQueueInternal()` (src/services/whatsappQueueWorker.ts) checked `isProcessing`, then `await isWhatsAppExplicitlyDisabled()` (DB read), THEN set `isProcessing=true`. Two concurrent entry points (`forceNext()` fired fire-and-forget by two rapid `enqueueArrivalWhatsApp` calls when both orders were marked Ready in one request, plus the 10 s scheduler tick) both passed the stale check during that await gap and ran parallel send loops over the same pending items → same item physically transmitted twice before either pass marked it 'sent'. (2) `sendMessage()` (src/whatsappClient.ts) registered `recentSendsCache` only after the awaited dispatch succeeded, so near-simultaneous duplicate calls both passed the 30 s suppression check. |
| **How it was fixed** | (1) The single-flight lock is now claimed synchronously immediately after the check, BEFORE any await; the disabled-check moved inside the existing try/finally so every early return still resets the lock. Parallel processor passes are now impossible. (2) `recentSendsCache.set(sendKey, nowTs)` now happens in-flight BEFORE dispatching; the pre-existing catch already deletes the key on failure so legitimate retries remain unblocked; post-send re-set on the WA-Web path kept as harmless refresh. |
| **Priority** | P1 |
| **What not to touch** | Queue-level same-day dedupe + `skipDedupe` resend semantics unchanged; outbox verification / crash-recovery paths untouched; direct-sender call sites (emailService etc.) untouched — they are protected by fix (2). Outbox-capture gaps (delivered-but-unrecorded twins) are a separate recording issue, intentionally not addressed here. |
| **Verified by** | `tsc --noEmit` clean (backend); DB evidence matched root cause exactly (queue had ONE SOFIRASH item yet TWO delivered IDs same second; lock await-gap present at the time); code review confirms no remaining await between lock check and set and cache registration precedes all dispatch paths (WA-Web line ~1057 refresh, Business line ~1134, catch-delete ~1138 preserved). |

### [Fixed] P1-03 — Boot-window distributor WhatsApp alerts failing permanently ("WhatsApp session is not connected")

| Field | Content |
|-------|---------|
| **What the user saw** | "❌ WhatsApp message to A.S DISTRIBUTOR failed: WhatsApp session is not connected. Please scan the QR code…" toasts on/shortly after app boot, repeating on every new UI session even days later. |
| **Root cause** | Two gaps beyond P1-02: (1) `emailService` mail-arrival and distributor-invoice alerts call personal-WA `sendMessage()` DIRECTLY (bypassing `whatsapp_send_queue`). The email poller starts at boot, so new distributor invoices fire while the WA session is still restoring → instant throw → permanent `automation_notifications` status='failed' row with that error message. (2) Layout's queue-status poller toasts ANY of the last-200 recent items mapped `failed_perm`, with only a per-browser-session dedupe — persisted historical rows re-toast on every reload. |
| **How it was fixed** | New exported `waitForWhatsAppReady(timeoutMs=90s)` in `src/whatsappClient.ts`: bounded readiness wait that joins/kicks the single-flight init when a saved session exists, returns false fast for disabled/QR-less/business-routed setups, re-kicks at most every 20 s. Wired before both direct sends in `src/services/emailService.ts`. Layout.tsx failure toast now has a 15-minute freshness guard (`created_at`) so stale rows never re-toast. |
| **Priority** | P1 |
| **What not to touch** | User-clicked send paths (orders/refills/messaging routes) intentionally keep immediate lazy-init + fast-clear-error semantics; do not add waits there. Existing 'failed' rows remain in DB until user clears/retries via Queue UI. |
| **Verified by** | `tsc --noEmit` clean (backend + frontend); boot with saved session + pending invoice email → alert dispatches after restore instead of failing; no historical-failure toast spam on reload. |

### [Fixed] P1-01 — False "Pharmarack cart sync pending" toast on first boot

| Field | Content |
|-------|---------|
| **What the user saw** | On every app boot, Activity panel shows "⚠️ Pharmarack cart sync pending — Session may need refresh from Learning page." even when the Pharmarack session was healthy. |
| **Root cause** | `startupSyncCoordinator.markCartLoaded()` was only called at the end of a successful `GET /api/pharmarack/cart` request. Nothing fetched the live cart at boot — the T+2s token refresh scheduler refreshes only the auth token. Frontend checked `/api/pharmarack/startup-sync-status` once after 46 s; with no UI visit yet, `timedOut && !cartLoaded` always fired the toast. |
| **How it was fixed** | Extracted shared loader `loadLiveCartCore()` in `src/routes/pharmarack.ts` (used by GET /cart AND new exported `warmupStartupCart()`). server.ts chains the warm-up on `tokenRefreshScheduler.onFirstRefreshComplete()` (new hook) with a T+50s fallback; warm-up populates `serverCartCache`, marks loaded on success, marks loaded immediately when no token is configured (non-users never nagged), and deliberately leaves sync pending on real session/network failures so the toast stays truthful. Layout.tsx re-checks at 110 s (toast fires at most once). |
| **Priority** | P2 |
| **What not to touch** | GET /cart snapshot auto-notification transitions (`notifyDistributorCartOrder`) remain UI-visit-only semantics; do not run them from the boot warm-up. |
| **Verified by** | `tsc --noEmit` clean (backend + frontend); boot log shows `[StartupSync] Boot cart warm-up complete` or a truthful skip; no false toast within 46–110 s window on healthy-token boots. |

### [Fixed] P1-02 — First-boot WhatsApp send failures ("WhatsApp session is not connected")

| Field | Content |
|-------|---------|
| **What the user saw** | Distributor WhatsApp notifications failed shortly after boot: "WhatsApp session is not connected. Please scan the QR code in Settings or click 'Open Live Chrome Window' to log in." Some queue items burned retries to permanent failure while other sends hung forever until restart. |
| **Root cause** | Two compounding gaps: (1) In `launchClientInstance()` (src/whatsappClient.ts), the three QR exit paths — unsolicited-QR suppression, 120 s QR-scan timeout, 5-QR max-refresh stop — returned without settling the promise, leaving `initPromise` pending forever so every later caller joined a dead flight (deadlock). (2) The queue worker's per-item check skipped dispatching only when `!initializing`, so items were marked `sending` during an in-flight restore and each attempt incremented `retry_count` toward `failed_perm` within ~3 minutes of boot. |
| **How it was fixed** | whatsappClient.ts: all three QR exits now call `reject(...)` with clear user-facing messages (initClient catch/finally already resets flags and clears `initPromise`). whatsappQueueWorker.ts: offline gate breaks whenever `!isReady` regardless of `initializing` (items stay pending through boot restore), plus a self-heal that silently retries `initClient()` on a 60 s cooldown when `hasSavedSession()` is true — no unsolicited QR, no retry burn. |
| **Priority** | P1 |
| **What not to touch** | `auth_failure` handler already rejected correctly — unchanged. Manual `retryAllFailed()` remains the revival path for already-burned `failed_perm` items. |
| **Verified by** | `tsc --noEmit` clean; simulated QR-timeout now fails sends fast with actionable error instead of hanging; queued items created pre-restore stay `pending` and dispatch once the client reports ready. |

### [Fixed] P1-18 — AI Camera & Packaging Catalog Cross-Check and Modifier Safety Architecture

| Field | Content |
|-------|---------|
| **What the user saw** | Dytor 20 (`DYTOR 20`) showed an image of Dytor 10 (`DYTOR 10`) in the catalog, and camera scans had risk of cross-matching plain medicines to combo/kit variants (e.g. Dytor vs Dytor Plus / Dytor Combikit) or selecting wrong-strength inventory batches during POS checkout. |
| **Root cause** | Four compounding gaps: (1) `catalogImageService` online candidate downloader stripped dosage numbers and took first image blindly without candidate strength vetting, (2) Dytor 20 primary images pointed to transparent blister bubble fronts rather than printed foil backs, (3) `productNameFilterService` and `aiCameraService` lacked formulation modifier conflict gating (plain vs Plus, Combikit, DS, Forte, D, DSR, H, AM) and similarity comparisons penalized pharmacopoeia standards tokens (`IP`, `BP`), (4) POS `handleScanResult` ignored backend-ranked strength confirmations and did a naive local name prefix match that could select wrong strength batches. |
| **How it was fixed** | (1) Repaired `data/app.db` catalog images: Dytor 20 primary image linked to verified printed foil back (`dytor-20mg-back.jpg`), wrong Plus/Combikit images deactivated, and 10,821 disk images validated; (2) `productNameFilterService.ts`: added `extractFormulationModifiers()`, `hasFormulationModifierConflict()`, and `stripPharmacopoeiaMarkers()`, applying -0.45 modifier conflict penalty in `enhancedSimilarity`, FTS5 scoring, and full-array search; (3) `aiCameraService.ts`: added packaging cross-check confirmation gate and re-ranking, exposing `strengthConfirmed`, `volumeConfirmed`, `modifierConflict`, and `confirmationNote`; (4) `AICamera.tsx`: integrated real-time verification feedback badge (`✓ Strength Confirmed` in green or `⚠ Check Packaging` in amber); (5) `POS/index.tsx`: prioritized backend `result.matches` and enforced strength-matching inventory batch selection with active protection against silent wrong-strength batch fallback. |
| **Priority** | P1 |
| **What not to touch** | Keep offline OCR fallback intact; preserve semantic Tailwind tokens in AICamera modal; do not invent batches when out of stock. |
| **Verified by** | `scripts/test_aicamera_strength_confirmation.mjs` 7/7 PASS; `tests/services/productNameFilterService.test.ts` 7/7 PASS; `npm run build:client` PASS; `npm run guardrails` clean (0 violations); knowledge graph auto-synced. |

---

## Open

(none)
