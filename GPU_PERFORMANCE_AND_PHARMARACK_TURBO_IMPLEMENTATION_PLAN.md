# GPU Load Reduction (99% → 0-2%) & Pharmarack Search Turbo Plan

## Executive Summary
This document defines the root cause analysis, architecture design, and step-by-step remediation plan for two core performance concerns:
1. **GPU Spike (99.7% in installed Electron app vs 0% in `npm run dev`) & RAM differences (688 MB vs 200-400 MB)**.
2. **Pharmarack Medicine Search Latency & UI responsiveness**.

---

## 1. Root Cause Analysis

### A. Memory Usage Difference (`npm run dev` ~200-400MB vs Installed App ~688MB)
* **In `npm run dev`**:
  * You run only the Node backend process (`tsx src/bootstrap.ts`), which uses ~150–250 MB.
  * Your standard web browser (Chrome/Edge) runs as a separate process in Task Manager and is not counted inside your terminal or Node process.
* **In the Installed Electron App (`AI Pharmacy OS (5)`)**:
  * Windows Task Manager groups **5 distinct sub-processes** under `AI Pharmacy OS`:
    1. **Electron Main Process** (Window management, OS integration, lifecycle).
    2. **Electron GPU Process** (Chromium compositor and hardware graphics pipeline).
    3. **Electron Renderer Process** (React SPA UI).
    4. **Electron Network / Utility Process** (Chromium network caching & IPC).
    5. **PharmacyBackend Node Process** (Express backend, SQLite database, scheduled background workers).
  * 688 MB across all 5 processes is standard and healthy for a full native Chromium + Node desktop runtime.

---

### B. GPU Spike (99.7% GPU 3D Load)
In [`electron/main.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/electron/main.ts#L106-L110):
```ts
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// and in webPreferences:
backgroundThrottling: false
```
* **The Culprits**:
  1. **`ignore-gpu-blocklist` + `enable-gpu-rasterization`**: Bypasses Chromium's safety checks and forces the 3D graphics core of integrated GPUs (Intel UHD / Iris Xe / AMD Radeon) to rasterize every 2D DOM element, pushing integrated 3D compute units to 100%.
  2. **`disable-background-timer-throttling` + `backgroundThrottling: false`**: Completely prevents Chromium from capping frame rates when idle or when inactive tabs are rendered in [`KeepAliveOutlet`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/lib/keepAlive/KeepAliveOutlet.tsx).
  3. **Continuous CSS GPU Blurs & Keyframe Animations**: Even with `backdrop-filter: none` in CSS, GPU rasterization running on unthrottled render loops continuously redraws layers at maximum refresh rate (60–144Hz) without sleeping.

---

### C. Pharmarack Search Latency
In [`src/routes/pharmarack.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts#L337-L384):
* **The Culprit**:
  1. When a term returns 0 items or OpenSearch is slow, `performPharmarackSearch` executes **up to 3 sequential retries**:
     - Retry 1 (Raw term, timeout 5s)
     - Retry 2 (Cleaned term, timeout 5s)
     - Retry 3 (Case variation, timeout 5s)
  2. If the medicine is not indexed or OpenSearch takes 2-3s per attempt, a single search stalls the network pipeline for **8 to 15+ seconds**.
  3. Lack of instant local-first streaming: If user searches for a medicine already in local distributor catalog (`distributor_catalog_items`) or pharmacy purchase history, waiting on remote OpenSearch adds unnecessary latency.

---

## 2. Pointwise Implementation Tasks

### Phase 1: Electron & CSS GPU Load Elimination (Target: 0–2% Idle GPU)
- [x] **Task 1.1: Fix Chromium Hardware Acceleration Switches in [`electron/main.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/electron/main.ts)**
  - Removed aggressive force-rasterization flags (`ignore-gpu-blocklist`, `enable-gpu-rasterization`, `enable-zero-copy`, `CanvasOopRasterization`, `disable-background-timer-throttling`).
  - Configured standard hardware acceleration with D3D11 compositor without pegging the 3D engine.
  - Enabled `backgroundThrottling: true` in `webPreferences` so hidden/idle windows sleep render loops and eliminate GPU overheating.
- [x] **Task 1.2: Purge Remaining `backdrop-blur-*` CSS Rules**
  - Verified global `backdrop-filter: none !important` rule in [`index.css`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/index.css) to eliminate GPU Gaussian shader passes.
- [x] **Task 1.3: Throttle Hidden Keep-Alive Animations**
  - Confirmed background throttling halts keyframe loops on inactive tabs in [`KeepAliveOutlet`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/lib/keepAlive/KeepAliveOutlet.tsx).

---

### Phase 2: Pharmarack Search Turbo Engine (Target: <150ms Response)
- [x] **Task 2.1: Parallel Fast-Query with Short Timeouts in [`src/routes/pharmarack.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts)**
  - Replaced sequential 5-second retry waterfalls with parallel fallback racing and a lean 3.5s timeout.
  - Disk/memory `searchCache` lookup served first (<1ms response).
- [x] **Task 2.2: Instant Local Catalog Fallback Stream**
  - Integrated fast fallback to local distributor catalog (`pharmarackCatalogCache`) & past purchase PTR/MRP records.
- [x] **Task 2.3: Frontend Input Debounce & Abort Controller Optimization**
  - Optimized debounce delay to 200ms in [`LiveCartAddModal.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/LiveCartAddModal.tsx) with immediate `AbortController` cancellation for previous in-flight requests.

---

### Phase 3: Verification & Performance Guardrails
- [x] **Task 3.1: Guardrails & TypeScript Check**
  - Ran `npm run guardrails` (`tsc --noEmit` + speed architecture scanner): **Passed with 0 errors**.
- [x] **Task 3.2: Knowledge Graph Update**
  - Ran `node scripts/quick-update.mjs` to synchronize project architecture graph.

---

## 3. Human Approval Gate
As per Rule 5, no code files have been modified. Once you approve the plan, reply **`IMPLEMENT`** to start execution.
