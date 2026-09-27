# Implementation Plan: Website Orders Payment Screenshot Preview & Web URL Resolution

## 1. Problem & Root Cause Analysis
1. **Raw Windows Filesystem Path in Web `<img>` Tag**:
   - When a WhatsApp customer sends a payment proof image, `whatsappIntentService.ts` saves the file to disk at `path.join(uploadsDir, 'payment_proof_SO-xxx.jpg')` and stores the raw absolute Windows filesystem path in `special_orders.payment_screenshot_path`:
     `E:\CURRENT PROJECT ON WORKING\AI PHARMACY v2\uploads\payment_proof_SO-TMSA-1.jpg`
   - In `frontend/src/pages/WebsiteOrders/index.tsx`, the review modal directly sets:
     `<img src={selectedScreenshot.path} />`
   - Web browsers strictly prohibit loading local drive paths (`E:\...`) due to cross-origin and security restrictions. The browser network request fails, triggering `onError`, which immediately hides the image element (`display: 'none'`).
2. **Missing Inline Thumbnail on Card**:
   - The order card in `/website-orders` only displays a button: "Inspect WhatsApp Payment Receipt".
   - The user cannot see the receipt image directly in the workflow without opening a popup modal.

## 2. Planned Changes

### Web URL Normalizer Helper (Frontend & Backend)
- [x] Task 1: Create robust `getMediaUrl(rawPath)` helper in `frontend/src/pages/WebsiteOrders/index.tsx`:
  - Translates any absolute filesystem path (e.g. `E:\...\uploads\payment_proof_xxx.jpg`) or relative path into browser-accessible `/uploads/payment_proof_xxx.jpg`.
  - Ensures full compatibility with Vite proxy (`/uploads` -> port 5174) and Express static file serving.
- [x] Task 2: Update `src/services/whatsappIntentService.ts` and `src/routes/websiteOrders.ts` to store web-accessible `/uploads/payment_proof_${soCode}.jpg` in `special_orders.payment_screenshot_path` when new receipts arrive.
- [x] Task 3: Heal existing records in `data/app.db` and added schema auto-healing in `src/database.ts` (fast-boot and full migrations):
  - Normalized existing DB rows to `/uploads/...`.

### UI Enhancement on `/website-orders` Card & Modal
- [x] Task 4: In `frontend/src/pages/WebsiteOrders/index.tsx`:
  - Added an inline payment proof image thumbnail directly inside the "WhatsApp Payment Receipt" card on each order, complete with click-to-zoom.
  - Updated the review modal with `getMediaUrl(selectedScreenshot.path)`, "Full Size" tab opener, and graceful fallback UI.
  - Added quick action: "Confirm Payment (₹50)" button right below the thumbnail on the card for 1-click verification without opening the modal.
  - Guarded prescription image views with `getMediaUrl` for consistent URL normalization.

### Testing & Verification
- [x] Task 5: Run integration tests (`npm test -- tests/websiteOrderIntegration.test.ts tests/specialOrderNotification.test.ts`) — PASS (9/9 passed).
- [x] Task 6: Run `npm run guardrails` (`tsc --noEmit`) to verify 0 compiler errors — PASS (0 violations).
- [x] Task 7: Update knowledge graph via `node scripts/quick-update.mjs` and log fix in `SMALL_BUG_FIX_PLAN.md`.
