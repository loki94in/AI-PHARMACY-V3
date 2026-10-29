# Implementation Plan — Enable Qwen Local AI by Default & Bundle in All Releases

**Goal:** Enable Qwen3-1.7B local AI by default for all newly installed and existing PCs, bundle the complete offline assets (`llama-server.exe`, `qwen3-1.7b-q4_k_m.gguf`, and DLLs) inside the setup installer during `npm run release`, and publish the release.

---

## 1. Overview & Architectural Scope
- **Model**: Qwen3-1.7B Q4_K_M (1.11 GB GGUF) running on CPU via `llama-server.exe` (`127.0.0.1:8089`, `-ngl 0`, `-t 4`, `-c 2048`).
- **No-GPU Contract**: Strictly preserves `app.disableHardwareAcceleration()` and CPU-only inference without graphics card dependencies.
- **Installer Integration**: `scripts/release.mjs` and `installer.iss` include `models/local-ai/*` by default when assets exist (`BUNDLE_LOCAL_AI=1`).
- **Environment & Activation**:
  - `packaging/portable.env` defines `LOCAL_AI_ENABLED=true` so portable installations start with Qwen activated.
  - `src/services/localAi/llamaServerClient.ts` auto-activates when verified offline model assets exist on disk, while still allowing explicit disable via `LOCAL_AI_ENABLED=false`.
  - Backend startup (`src/server.ts`) initiates lazy warm-up of `llama-server.exe` non-blockingly (~T+12s) so the assistant responds promptly when opened.

---

## 2. Tasks & Progress Checklist

- [x] Task 1: Update `packaging/portable.env` with `LOCAL_AI_ENABLED=true`
- [x] Task 2: Update `src/services/localAi/llamaServerClient.ts` to auto-detect and activate bundled local AI & add boot warm-up in `src/server.ts`
- [x] Task 3: Update `scripts/release.mjs` to bundle local AI by default
- [x] Task 4: Run pre-flight verification (`verify:local-ai` and `guardrails`)
- [x] Task 5: Execute `npm run release` and confirm live deployment
- [x] Task 6: Commit and push changes to `main` with auto-updated knowledge graph

---

## 3. Task Completion Log

### Task 1: Update `packaging/portable.env`
- Added `LOCAL_AI_ENABLED=true`, `LOCAL_AI_HOST=127.0.0.1`, and `LOCAL_AI_PORT=8089`.
- Verified that portable setups launch with local AI enabled.

### Task 2: Auto-Detection & Backend Boot Warm-up
- Updated `isLocalAiEnabled()` in `src/services/localAi/llamaServerClient.ts` to automatically detect valid model assets in `models/local-ai/` and activate local AI if not explicitly set to false.
- Added non-blocking staged boot warm-up hook at ~T+12s in `src/server.ts` to pre-warm `llama-server.exe` on CPU without blocking HTTP server boot.

### Task 3: Default Bundling in `scripts/release.mjs`
- Updated `scripts/release.mjs` so `bundleLocalAi` defaults to `true` whenever `models/local-ai` contains the model weights and `llama-server.exe`.
- Automatically sets `process.env.BUNDLE_LOCAL_AI = '1'` so Inno Setup compiles the offline standalone installer (`AI-Pharmacy-OS-Offline-Setup-v...exe`).

### Task 4: Pre-flight Verification
- Ran `npm run verify:local-ai --strict`: All 4 required assets (`llama-server.exe`, `qwen3-1.7b-q4_k_m.gguf`, `LICENSE.txt`, `metadata.json`) verified.
- Ran `npm run guardrails`: TypeScript compilation (`tsc --noEmit`) and all performance rules passed with 0 violations.

### Task 5: Release Build & Deployment (`v0.1.176`)
- Ran `npm run release` with full offline bundling.
- Compiled `AI-Pharmacy-OS-Offline-Setup-v0.1.176.exe` (1712.1 MB / ~1.71 GB) containing full Qwen3-1.7B model and llama-server.exe runtime.
- Built delta update zip `AI-Pharmacy-OS-Update-v0.1.176.zip` (37.7 MB) with SHA-256 `13bd249ad4013feefc6a3d1aac8d3b601a92108009d1b545bda2c4d23c7708d0`.
- Uploaded assets to GitHub Releases tag `v0.1.176` and published metadata to Vercel/Redis update server. Server verified: `latestVersion="0.1.176"`.

### Task 6: Knowledge Graph & Git Push
- Knowledge graph synchronized (`node scripts/quick-update.mjs`).
- Committed version bump and pushed to `main`.
