# Implementation Plan: Rust (Tauri v2) Desktop Shell (`PharmacyOS.exe`)

## Goal
Replace the Electron desktop window wrapper (`PharmacyOS.exe`) with a lightweight **Rust + Tauri v2** shell using Windows WebView2, keeping the existing Node SEA backend (`PharmacyBackend.exe`) as the managed child process. This cuts UI-shell RAM/CPU and binary size (~8–15 MB vs ~100+ MB Electron) while keeping 100% of existing backend/frontend functionality intact.

## Toolchain
- Rust `rustc` / `cargo` (`E:\CURRENT PROJECT ON WORKING\Coucou\.toolchain\rust\cargo\bin`)
- MinGW-w64 `gcc` (`E:\CURRENT PROJECT ON WORKING\Coucou\.toolchain\w64devkit\bin`) for `x86_64-pc-windows-gnu`
- Microsoft Edge WebView2 Runtime (pre-installed on Windows)

## Architecture & Parity Checklist
1. **No-GPU Rendering Contract**: Set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (`--disable-gpu --disable-gpu-compositing --disable-gpu-rasterization --use-gl=swiftshader`) before WebView2 initializes.
2. **Single-Instance Lock**: Use `tauri-plugin-single-instance` so a second launch focuses/restores the existing window instead of colliding on port `5175`.
3. **Window-First, Backend-Second**:
   - Open the main window immediately (`1366x868`, min `1024x700`, fullscreen unless `APP_WINDOW_MODE=maximized`, dark `#0f172a` background, `packaging/app.ico`) showing an inline HTML splash screen (`Starting AI Pharmacy OS…`).
   - In a background thread:
     1. Check `http://127.0.0.1:5175/api/health/ready` — if already healthy (external dev backend), navigate directly without spawning.
     2. Otherwise, reclaim port `5175` from stale listeners (`netstat` / `taskkill /F /T /PID`), clean leftover Chromium profile locks (`SingletonLock`, `lockfile`, `devtoolsactiveport`) in `exeDir` and `%LOCALAPPDATA%\AI Pharmacy OS`, and spawn `PharmacyBackend.exe` (with `ELECTRON_MODE=true`, `PORT=5175`, `NODE_OPTIONS=--max-old-space-size=512`, `CREATE_NO_WINDOW`, stdout/stderr logged to `data/backend.log`).
     3. Poll `http://127.0.0.1:5175/api/health/ready` every `50ms` and navigate the WebView2 window to `http://127.0.0.1:5175` as soon as ready.
4. **Clean Shutdown**: On window close/exit, terminate the spawned `PharmacyBackend.exe` process tree (`taskkill /F /T /PID`) if it was spawned by this shell so no orphan process locks files during updates.
5. **Packaging Integration**:
   - Add `src-tauri/` (`Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `src/main.rs`).
   - Update `scripts/buildSea.cjs` to build the Rust Tauri binary and copy it to `dist/PharmacyOS.exe` (keeping `electron/main.ts` untouched for guardrail E1).
   - Add `tauri:build` / `tauri:dev` scripts in `package.json`.

## Tasks & Completion Log
- [x] **Task 1**: Scaffold `src-tauri/` (`Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `splash/index.html`, `src/main.rs`) and verify `cargo build --release` compiles cleanly (`21.48 MB` binary).
- [x] **Task 2**: Wire `scripts/buildSea.cjs` Step 5 to build `dist/PharmacyOS.exe` from Rust/Tauri using `w64devkit` + space-free `CARGO_TARGET_DIR`, verified via `SKIP_INSTALLER=1 node scripts/buildSea.cjs`.
- [x] **Task 3**: Verify `npm run guardrails` passes and `node scripts/quick-update.mjs` updates the knowledge graph.
