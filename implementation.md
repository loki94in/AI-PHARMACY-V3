# Implementation Plan — Cloudflare R2 Model Hosting & Download Integration

## Objective
Enable seamless downloading and activation of the offline Local AI model (`qwen3-1.7b-q4_k_m.gguf` ~1.04 GB and `llama-server.exe` runtime) from Cloudflare R2 object storage onto client PCs. Ensure resilient URL resolution, byte-range resuming, SHA-256 integrity verification, and automated R2 manifest generation.

---

## 1. Architectural Design
- **Cloudflare R2 Bucket**: Stores `manifest.json`, `qwen3-1.7b-q4_k_m.gguf`, `llama-server.exe`, `metadata.json`, and `LICENSE.txt`.
- **Egress & Cost**: Zero download bandwidth cost, free tier up to 10 GB.
- **Client Resolution**:
  - `LOCAL_AI_ASSET_BASE_URL` (e.g. `https://models.yourpharmacy.com` or `https://pub-<hash>.r2.dev`)
  - `LOCAL_AI_MANIFEST_URL` (e.g. `https://models.yourpharmacy.com/manifest.json`)
  - `modelDownloadManager.resolveArtifactUrl` resolves each artifact (`qwen3-1.7b-q4_k_m.gguf`, `llama-server.exe`) to `${LOCAL_AI_ASSET_BASE_URL}/${filename}`.
- **Byte-Range Resume**: HTTP `Range: bytes=X-` supported for resuming interrupted 1 GB downloads.
- **Integrity**: Exact SHA-256 verification after download before atomic activation.

---

## 2. File-by-File Implementation Plan

| Step | File | Action | Purpose |
| :---: | :--- | :---: | :--- |
| **1** | `src/services/localAi/modelDownloadManager.ts` | **Modify** | Update `resolveArtifactUrl` to cleanly resolve Cloudflare R2 base URLs without internal domain restrictions. |
| **2** | `src/services/localAi/localAiLifecycleManager.ts` | **Modify** | Ensure `fetchRemoteManifest` properly defaults to `${LOCAL_AI_ASSET_BASE_URL}/manifest.json` when `LOCAL_AI_MANIFEST_URL` is omitted. |
| **3** | `models/local-ai/manifest.json` | **Modify** | Standardize artifact URLs to relative filenames compatible with any R2 bucket base URL. |
| **4** | `scripts/publish-local-ai-to-r2.mjs` | **Create** | Utility script to verify hashes, update `manifest.json`, and provide R2 upload guidance. |
| **5** | `tests/localAiCloudInstallation.test.ts` | **Modify** | Add test verifying Cloudflare R2 URL resolution and manifest downloading. |
| **6** | Verification & DOX | **Run** | Run test suite, check performance guardrails, and update knowledge graph. |

---

## 3. Tasks & Execution Log

### Task 1: Update `src/services/localAi/modelDownloadManager.ts`
- [x] Supported dynamic Cloudflare R2 base URL resolution (`LOCAL_AI_ASSET_BASE_URL`) for all relative artifact paths.

### Task 2: Update `src/services/localAi/localAiLifecycleManager.ts`
- [x] Ensured `fetchRemoteManifest` resolves from R2 base URL (`${LOCAL_AI_ASSET_BASE_URL}/manifest.json`) when custom manifest URL is omitted.

### Task 3: Update `models/local-ai/manifest.json`
- [x] Standardized artifact URLs to relative filenames compatible with any R2 bucket base URL.

### Task 4: Create `scripts/publish-local-ai-to-r2.mjs`
- [x] Created automated manifest generator and R2 upload helper that computes SHA-256 hashes, file sizes, and generates R2 sync instructions.

### Task 5: Add tests and verify
- [x] Added Cloudflare R2 URL resolution test in `tests/localAiCloudInstallation.test.ts` (15/15 passed).
- [x] Verified full regression suite: 32 tests passed across local AI and auto-update suites.
- [x] Ran `npm run guardrails` — clean pass (`tsc --noEmit` OK, zero violations).
- [x] Updated auto-knowledge graph via `node scripts/quick-update.mjs`.

### Task 6: Production Release `v0.1.174`
- [x] Auto-bumped version to `0.1.174`.
- [x] Compiled standalone installer (`AI-Pharmacy-OS-Cloud-Setup-v0.1.174.exe`, 649.8 MB) and update package (`AI-Pharmacy-OS-Update-v0.1.174.zip`, 37.7 MB).
- [x] Uploaded artifacts and mobile APK to GitHub release `v0.1.174`.
- [x] Published production metadata to Vercel update server (`rolloutMode: ALL`).
- [x] Re-verified live server endpoint confirms `latestVersion: 0.1.174`.
