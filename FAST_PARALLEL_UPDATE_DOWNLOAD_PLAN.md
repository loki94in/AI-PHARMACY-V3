# Fast Parallel Auto-Update Download & Release CDN Pre-Warm Plan

## Problem
- Right after `npm run release`, downloading `AI-Pharmacy-OS-Update-vX.Y.Z.zip` (~38 MB) via the single-stream Node `https.get` in `src/services/autoUpdateService.ts` (`downloadFile`) hit ~38–45 KB/s when GitHub's Fastly CDN edge had a cold cache miss against Azure Blob origin (`releaseassetproduction.blob.core.windows.net`).
- At the same moment, byte-range requests (`Range: bytes=...`) achieved ~5.4 MB/s, and once the CDN edge warmed up, full downloads achieved ~8.5 MB/s (~4.6 s for 38 MB).

## Architecture & Minimal Surgical Changes
1. **`src/services/autoUpdateService.ts` (`downloadFile`)**:
   - Export `downloadFile` for direct real-HTTP verification tests.
   - Add a `probeDownload(url)` helper (follows up to 5 redirects via `HEAD`) to resolve the final CDN URL and inspect `accept-ranges: bytes` and `content-length`.
   - When `accept-ranges === 'bytes'` and `totalBytes >= 2 MB`, download using **6 parallel HTTP `Range` workers** writing directly to positional offsets in a pre-allocated `.tmp` file (`fs.promises.open`), with per-chunk resume on transient `502`/`503`/`504`/socket errors and a single 120 s inactivity `req.setTimeout` per request (removed from the hot `res.on('data')` callback).
   - Fall back cleanly to single-stream `GET` when `HEAD` is unsupported, `Accept-Ranges` is absent, or `totalBytes < 2 MB`.
   - Verify exact total byte count before atomic rename `tempDest -> dest`, and delete `.tmp` on any failure.
2. **`scripts/release.mjs`**:
   - After Step 4 (GitHub release upload) and before Step 5 (Vercel/KV update publish), add a non-blocking CDN pre-warm step on `updatePackageUrl` so GitHub's Fastly edge caches the new ZIP before client PCs detect the release.
3. **`tests/autoUpdateParallelDownload.test.ts`**:
   - Test against a real local Node `http.createServer`:
     - Parallel `Range` download (>= 2 MB) produces byte-exact file + accurate monotonic progress.
     - Single-stream fallback when `Accept-Ranges` is absent or `HEAD` returns 405.
     - Redirect following + transient 503 retry + mid-chunk resume on socket drop.
     - Cleanup of `.tmp` file on non-2xx HTTP error.
4. **DOX & Knowledge Graph**:
   - Update `src/AGENTS.md` In-App Auto-Update section.
   - Run `npm run guardrails`, Jest test suite for auto-update, and `node scripts/quick-update.mjs`.

## Tasks & Completion Log
- [x] Task 1: Implement parallel HTTP `Range` downloader (`downloadParallelRanges` + `probeDownload` + `downloadSingleStream` fallback) in `src/services/autoUpdateService.ts`
- [x] Task 2: Add non-fatal CDN pre-warm step (`Step 4b`) in `scripts/release.mjs`
- [x] Task 3: Add real-HTTP unit tests in `tests/autoUpdateParallelDownload.test.ts` (registered in `jest.config.js`) and verify all 3 auto-update suites pass (`20/20`)
- [x] Task 4: Update `src/AGENTS.md`, run `npm run guardrails`, and run `node scripts/quick-update.mjs`
