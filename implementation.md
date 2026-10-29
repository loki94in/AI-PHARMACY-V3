# Implementation Plan: AI-PHARMACY-V3 Release Candidate Testing & Verification

## 1. Objective & Scope
Validate that the cloud-download installer (Mode A) and fully bundled offline installer (Mode B) are safe, repeatable, cryptographically secure, and ready for release.

Target: Qwen3-1.7B Q4_K_M + llama.cpp (win-cpu-x64)  
Platform: Windows  
RAM Target: 8 GB budget (< 2 GB model peak RSS, leaving > 6 GB for Windows OS and Electron)  
Offline Guarantee: 100% offline inference after installation, zero external telemetry/inference calls.

---

## 2. Key Changes & Architecture Upgrades

### RC-01: Installer Output Isolation
- Modified `installer.iss` and `scripts/buildSea.cjs` to output distinct, unambiguous installer binaries:
  - Mode A (Cloud): `dist/installer/AI-Pharmacy-OS-Cloud-Setup-v{version}.exe` (649.5 MB)
  - Mode B (Offline): `dist/installer/AI-Pharmacy-OS-Offline-Setup-v{version}.exe` (1,711.62 MB)
- Emitted distinct JSON build manifests (`build-manifest-cloud.json` and `build-manifest-offline.json`) recording exact file sizes, SHA-256 hashes, build modes, and included asset manifests.
- Updated `scripts/release.mjs` to recognize isolated installer filenames.

### Medicine & Intent Sanitization (Preventing "BP" -> bottle hallucinations)
- Upgraded `src/services/localAi/structuredIntentParser.ts`:
  - Added `NON_MEDICINE_TERMS` catalog (medical conditions: `BP`, `blood pressure`, `sugar`, `diabetes`, `fever`, `bukhar`, `pain`, `cold`, `cough`, `gas`, `acidity`, etc.; generic descriptors: `dawai`, `goli`, `medicine`, `regular dawai`, `same medicine`).
  - Strict rejection in `normalizeMedicineItem`: if candidate name matches non-medicine conditions, drops it from `medicines` array.
  - Rejects invented quantities or default units for non-medicine requests.
  - Sanitizes prompt-injection and executable-like syntax in model output.

### Automated Test Suite: `tests/localAiReleaseCandidate.test.ts`
- Automated test coverage for:
  - RC-01: Output isolation & build manifest verification
  - RC-02: Cloud download integrity, HTTP Range resume, corruption rejection, signature verification
  - RC-03: WhatsApp connection independence (missing model, downloading model, offline server, reconnects)
  - RC-04: Deterministic parser authority (ambiguous text, model crashes, delayed output, zero business mutations)
  - Accuracy: Multi-lingual dataset (English, Hindi, Hinglish, Marathi, colloquial, spelling errors, repeat, confirmation, BP refill query)
  - Security: Prompt injection, script tags, bounds clamping, NaN rejection

---

## 3. Completed Tasks & Progress Tracker

- [x] **Task 1: Installer Output Isolation in `installer.iss` and `scripts/buildSea.cjs`**
  - **How it was completed**: Updated `installer.iss` with `#ifndef OutputBaseFilename` branching on `#ifdef BundleLocalAi`, producing `AI-Pharmacy-OS-Offline-Setup-v...` or `AI-Pharmacy-OS-Cloud-Setup-v...`. Updated `scripts/buildSea.cjs` to pass `/DOutputBaseFilename=...` and emit `build-manifest-cloud.json` or `build-manifest-offline.json` with file sizes and SHA-256 checksums. Updated `scripts/release.mjs` locator.
  - **Verification**: Verified that both builds create separate files without overwriting each other.

- [x] **Task 2: Precision Intent & Medicine Parser Sanitization in `structuredIntentParser.ts`**
  - **How it was completed**: Implemented `NON_MEDICINE_TERMS` and `isNonMedicineCondition` in `src/services/localAi/structuredIntentParser.ts`. Filtered medical conditions (`BP`, `Sugar`, `Fever`, `Bukhar`, etc.) and generic placeholders from candidate medicine items. Added command/script injection filtering (`<script>`, `cmd.exe`, `powershell`, `rm -rf`, `DROP TABLE`).
  - **Verification**: Verified that `"BP"` with unit `"bottle"` is rejected and returns empty medicines list.

- [x] **Task 3: Implement Automated RC Test Suite in `tests/localAiReleaseCandidate.test.ts`**
  - **How it was completed**: Created 23 automated regression tests in `tests/localAiReleaseCandidate.test.ts` covering RC-01 to RC-04, multi-lingual dataset, BP condition rejection, command injection, and bounds clamping. Added file to `jest.config.js`.
  - **Verification**: All 23 tests passed. Total local AI suite passed 61/61 tests.

- [x] **Task 4: Build Both Installer Configurations (Mode A & Mode B) Side-by-Side**
  - **How it was completed**: Executed `npx cross-env BUNDLE_LOCAL_AI=0 node scripts/buildSea.cjs` (Cloud) and `npx cross-env BUNDLE_LOCAL_AI=1 node scripts/buildSea.cjs` (Offline). Both installers exist side-by-side in `dist/installer/`.
  - **Verification**:
    - Mode A (Cloud): `AI-Pharmacy-OS-Cloud-Setup-v0.1.172.exe` — **649.5 MB**, SHA-256: `aadac4440626dee4e0fc527bd2a62732673d41bdac6872321bb1ac77b1720eef`
    - Mode B (Offline): `AI-Pharmacy-OS-Offline-Setup-v0.1.172.exe` — **1,711.62 MB**, SHA-256: `b40b6640d6c65de554c80564cf76a4041b0466203f0e60c21bc4c350db092956`

- [x] **Task 5: Clean-Install Verification & Offline Inference in Sandboxed Target Directory**
  - **How it was completed**: Installed `AI-Pharmacy-OS-Offline-Setup-v0.1.172.exe` silently to `%LOCALAPPDATA%\Temp\ai-pharmacy-offline-rc-test`. Verified all assets extracted (`llama-server.exe`, DLLs, `qwen3-1.7b-q4_k_m.gguf`, licenses, metadata). Spawned installed runtime on port 8098 and executed real offline inference query (`bhai amoxicillin 500mg 2 strip bhej do`). Verified valid JSON response and clean process termination. Cleaned up sandbox.
  - **Verification**: 100% offline inference verified directly from installed package.

- [x] **Task 6: Physical PC Hardware & Memory Benchmark (8 GB Analysis)**
  - **How it was completed**: Measured live model execution metrics on physical Intel Core i7-4770TE @ 2.30 GHz (4 CPU threads, -ngl 0):
    - Startup time: **2,266 ms** (~2.27s)
    - Peak Process Working Set: **1,689.0 MB** (~1.65 GB)
    - 8 GB Budget Allocation: **20.6% of 8 GB**, leaving > 6.3 GB for Windows OS and Electron.
    - Documented honest distinction between 12 GB host RAM and 8 GB minimum production specification.

- [x] **Task 7: Regression Suite, Performance Guardrails & DOX Knowledge Graph Update**
  - **How it was completed**: Ran `tsc -p tsconfig.json` (0 errors), `npm run guardrails` (PASS — 0 violations), and `node scripts/quick-update.mjs` (synchronized 1299 nodes, 866 edges across 10 layers).
  - **Verification**: All guardrails intact.

- [x] **Task 8: Final Delivery Report & Release Gate Verification**
  - **How it was completed**: Compiled comprehensive Release Candidate testing report clearly distinguishing verified tests from hardware constraints.
