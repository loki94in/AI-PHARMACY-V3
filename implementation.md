# Implementation Plan: Cloud-Hosted Local AI Model Installation & Lifecycle

Modify the local AI integration so AI Pharmacy OS can download Qwen3-1.7B Q4_K_M and its compatible llama.cpp runtime from verified cloud-hosted release assets upon WhatsApp connection, while executing strictly locally with zero external inference.

## User Requirements & Architecture
1. **Preserve Existing Architecture**:
   - Deterministic parser and all business workflows remain 100% authoritative.
   - Passive shadow mode only for ambiguous text.
   - Bypasses (confirmations, media, repeats, explicit IDs) strictly preserved.
   - Zero business impact: No orders, carts, POS, CRM, or pricing driven by model output.
2. **Cloud Asset Distribution & Security**:
   - Configurable HTTPS asset base URL (`LOCAL_AI_ASSET_BASE_URL`).
   - Signed, versioned release manifest (`manifest.json` + signature) with SHA-256 checksums, expected file sizes, and compatibility metadata.
   - Manifest authenticity validation (trusted public key / signature verification).
   - Strict path traversal protection (reject `..`, absolute paths, slashes).
3. **WhatsApp Connection Lifecycle**:
   - On WhatsApp `ready`:
     - If local AI enabled and assets missing, trigger non-blocking background download.
     - WhatsApp connection and chatbot operations are never blocked.
   - Download manager supports:
     - Progress broadcasting via SSE (`local_ai_download_progress`) and REST API (`/api/local-ai/status`).
     - Resuming interrupted downloads with HTTP `Range` headers.
     - Cancellation (`/api/local-ai/cancel`) and retry (`/api/local-ai/retry`).
     - Atomic activation: download to `.staging`, verify SHA-256 for all artifacts, then swap into active directory.
     - Avoid redundant downloads when installed assets already match manifest version and hashes.
   - Health check: starts runtime locally on CPU (`-ngl 0`), verifies `/health` before marking ready.
4. **Local Storage & Security**:
   - Per-user directory: `path.join(getAppDataDir(), 'models', 'local-ai')`.
   - Never execute unverified binaries.
   - Check disk space before multi-gigabyte downloads.
   - Never upload customer or pharmacy data to the asset server.
5. **Build Modes**:
   - `BUNDLE_LOCAL_AI=1`: fails build if model, runtime, license, or metadata are missing from `models/local-ai/`.
   - Cloud-download mode: packages app without model, claims no offline AI in cloud installer.
6. **Regression Tests**:
   - Missing assets, successful download & checksum, corrupt/tampered/truncated downloads, resume, cancellation, duplicate prevention, runtime health failure, responsive WhatsApp, deterministic fallback, build failure on `BUNDLE_LOCAL_AI=1`.
7. **Documentation & Rollout**:
   - Document asset layout, manifest schema, publishing procedure, lifecycle, rollback, and troubleshooting in `docs/LOCAL_AI_CLOUD_INSTALLATION.md`.

---

## File Structure Plan

| Path | Purpose | Status |
|------|---------|--------|
| `src/services/localAi/manifestSchema.ts` | Manifest types, signature verification, and URL resolution | Completed |
| `src/services/localAi/localAiStorage.ts` | Path resolution in `getAppDataDir()`, disk space checks, path traversal sanitization | Completed |
| `src/services/localAi/modelDownloadManager.ts` | Resilient HTTP streaming downloader with resume, SHA-256 verification, cancellation, and atomic activation | Completed |
| `src/services/localAi/localAiLifecycleManager.ts` | Orchestrates check -> download -> verify -> start runtime -> health check -> ready | Completed |
| `src/routes/localAi.ts` | Express REST endpoints (`GET /status`, `POST /download`, `POST /cancel`, `POST /retry`, `POST /toggle`) | Completed |
| `src/whatsappClient.ts` | Hook into WhatsApp `ready` event to trigger non-blocking AI verification/download | Completed |
| `src/server.ts` | Register `/api/local-ai` route | Completed |
| `tests/localAiCloudInstallation.test.ts` | 13 comprehensive regression tests covering download, checksum, resume, cancel, and WhatsApp resilience | Completed |
| `docs/LOCAL_AI_CLOUD_INSTALLATION.md` | Complete architecture, manifest schema, and rollout documentation | Completed |

---

## Completed Tasks & Progress Tracker

- [x] **Task 1: Create `src/services/localAi/manifestSchema.ts`**
  - **How it was completed**: Defined `ManifestArtifact` and `LocalAiReleaseManifest`. Implemented `sanitizeManifestFilename` which rejects path traversal patterns (`..`, slashes, null bytes). Built `verifyManifestAuthenticity` supporting ECDSA public keys and HMAC secrets.
  - **Verification**: Unit tested with valid filenames, evil traversal paths, valid signatures, and tampered signatures.

- [x] **Task 2: Create `src/services/localAi/localAiStorage.ts`**
  - **How it was completed**: Implemented `getLocalAiStorageDir()` targeting per-user AppData (`path.join(getAppDataDir(), 'models', 'local-ai')`). Created `checkSufficientDiskSpace()` using Node's `statfs` with a 250 MB margin. Implemented `activateStagedAssets()` with backup and automatic rollback on activation errors.
  - **Verification**: Verified directory resolution and integrity checking with real and mock files.

- [x] **Task 3: Create `src/services/localAi/modelDownloadManager.ts`**
  - **How it was completed**: Built `ModelDownloadManager` supporting streaming downloads, HTTP `Range` resume from `.part` files, synchronous duplicate download prevention, cancellation via `AbortController`, SHA-256 checksum verification, and SSE progress broadcasting (`local_ai_download_progress`, `local_ai_status_changed`).
  - **Verification**: Tested successful streaming, corrupted checksum rejection, Range resume, cancellation, and duplicate-request rejection.

- [x] **Task 4: Create `src/services/localAi/localAiLifecycleManager.ts` and update `src/whatsappClient.ts`**
  - **How it was completed**: Built `LocalAiLifecycleManager` orchestrating status checks, manifest retrieval, background download, and runtime health check. Wired into `src/whatsappClient.ts` on the `ready` event using non-blocking dynamic import so WhatsApp connection and deterministic message handling are never delayed.
  - **Verification**: Verified lifecycle flow and error resilience when Local AI is disabled, missing, or when runtime fails health checks.

- [x] **Task 5: Create `src/routes/localAi.ts` and register in `src/server.ts`**
  - **How it was completed**: Built `GET /api/local-ai/status`, `POST /api/local-ai/download`, `POST /api/local-ai/cancel`, `POST /api/local-ai/retry`, and `POST /api/local-ai/toggle`. Mounted in `src/server.ts` via lazy route wrapper.
  - **Verification**: Verified route definitions and types.

- [x] **Task 6: Implement comprehensive regression tests in `tests/localAiCloudInstallation.test.ts` & update `jest.config.js`**
  - **How it was completed**: Added 13 unit and regression tests with a mock local HTTP streaming server covering path traversal protection, HMAC signature verification, full download, checksum tampering rejection, Range resume, cancellation, duplicate prevention, deduplication on existing assets, lifecycle non-blocking execution, and `BUNDLE_LOCAL_AI=1` build failure.
  - **Verification**: `tests/localAiCloudInstallation.test.ts` passed 13/13. Combined with `tests/localAiStructuredIntent.test.ts`, all **37/37 tests passed**.

- [x] **Task 7: Update documentation in `docs/LOCAL_AI_CLOUD_INSTALLATION.md` and `AGENTS.md`**
  - **How it was completed**: Created `docs/LOCAL_AI_CLOUD_INSTALLATION.md` detailing cloud asset layout, signed manifest format, verification standards, WhatsApp lifecycle diagram, REST API specs, build modes, and troubleshooting. Updated `AGENTS.md` DOX contract.
  - **Verification**: Reviewed documentation for completeness and clarity.

- [x] **Task 8: Run performance guardrails (`npm run guardrails`) and knowledge graph sync (`node scripts/quick-update.mjs`)**
  - **How it was completed**: Ran `npm run guardrails` (scanned changed files, `tsc --noEmit` passed, 0 violations). Ran `node scripts/quick-update.mjs` (synchronized 1294 nodes, 866 edges across 10 layers).
  - **Verification**: Guardrails passed with exit code 0.

- [x] **Task 9: Human-in-the-Loop review and completion report**
  - **How it was completed**: Prepared detailed report covering all implemented features, safety boundaries, test results, and verified vs untested behavior.
