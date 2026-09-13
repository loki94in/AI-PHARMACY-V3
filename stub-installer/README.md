# AI Pharmacy — Stub Installer

Small Electron app (~40 MB `.exe`) that users download first.

## What It Does

1. Shows a professional GUI window with your logo
2. User enters **License ID** + **License Key**
3. Validates against your Vercel license server (1 PC = 1 key)
4. Downloads the full AI Pharmacy installer from your Cloudflare tunnel
5. Installs silently → shows "Installation Complete"

## Files

| File | Purpose |
|------|---------|
| `main.js` | Electron main process (IPC handlers, download logic) |
| `preload.js` | Secure bridge between renderer and main |
| `renderer.html` | GUI (dark theme, custom titlebar) |
| `renderer.js` | Form logic, progress UI, screen transitions |
| `assets/icon.ico` | App icon (place your pharmacy logo here) |
| `package.json` | Build config (electron-builder → NSIS) |

## How to Build

```bash
cd stub-installer

# Install dependencies (one time)
npm install

# Test locally
npm start

# Build Windows .exe installer
npm run build
# Output: dist/AI Pharmacy Installer Setup.exe  (~40MB)
```

## Before Building

1. In `main.js`, ensure `LICENSE_SERVER` points to your deployed Vercel URL
2. Place your logo as `assets/icon.ico` (256x256 .ico recommended)
3. Update the `downloadUrl` in `renderer.js` to your actual installer download URL

## Download URL Setup

The stub downloads the full installer from a URL. Options:

| Option | How |
|--------|-----|
| Cloudflare Tunnel | Expose a local file server via your existing tunnel |
| GitHub Releases | Upload `ai-pharmacy-setup.exe` to a GitHub release |
| Vercel Edge | Add `/api/updates/latest-download` redirect to Vercel |

Simplest for now: upload the full `.exe` to a GitHub release and update the URL in `renderer.js`.
