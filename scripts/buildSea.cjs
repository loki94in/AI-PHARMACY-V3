#!/usr/bin/env node
/**
 * Packages AI Pharmacy OS into a native Electron desktop application
 * backed by a self-contained Node SEA backend (PharmacyBackend.exe).
 *
 * Architecture:
 *   - PharmacyOS.exe      -> Native Electron BrowserWindow UI launcher (replaces Chrome #1)
 *   - PharmacyBackend.exe -> Self-contained Node SEA backend (Express, SQLite, SSE, Port 5175)
 *   - installer.iss       -> Inno Setup installer packaging both into a portable setup
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const root = path.resolve(__dirname, '..');

// Read version from package.json — single source of truth (PRODUCTION.md §6)
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const APP_VERSION = pkg.version;
const distDir = path.join(root, 'dist');
const backendExe = path.join(distDir, 'PharmacyBackend.exe');
const blobPath = path.join(root, 'dist-pkg', 'sea-prep.blob');

fs.mkdirSync(distDir, { recursive: true });

console.log('[build-sea] Step 1: Generating SEA blob for backend...');
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], {
  cwd: root,
  stdio: 'inherit',
});

console.log('[build-sea] Step 2: Creating PharmacyBackend.exe (Node SEA)...');
if (fs.existsSync(backendExe)) fs.rmSync(backendExe);
fs.copyFileSync(process.execPath, backendExe);

console.log('[build-sea] Step 3: Injecting blob with postject...');
const q = (s) => `"${s}"`;
execSync(
  `npx --yes postject ${q(backendExe)} NODE_SEA_BLOB ${q(blobPath)} --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { cwd: root, stdio: 'inherit' }
);
console.log('[build-sea] ✓ PharmacyBackend.exe ready ->', backendExe);

console.log('[build-sea] Step 4: Compiling Electron main and preload scripts...');
const electronDistDir = path.join(distDir, 'electron');
fs.mkdirSync(electronDistDir, { recursive: true });
execSync(
  `npx esbuild electron/main.ts --bundle --platform=node --target=node20 --outfile=${q(path.join(electronDistDir, 'main.cjs'))} --external:electron`,
  { cwd: root, stdio: 'inherit' }
);
execSync(
  `npx esbuild electron/preload.ts --bundle --platform=node --target=node20 --outfile=${q(path.join(electronDistDir, 'preload.cjs'))} --external:electron`,
  { cwd: root, stdio: 'inherit' }
);

console.log('[build-sea] Step 5: Preparing Electron runtime (PharmacyOS.exe)...');
const electronSourceDir = path.join(root, 'node_modules', 'electron', 'dist');
const outElectronExe = path.join(distDir, 'PharmacyOS.exe');
if (fs.existsSync(outElectronExe)) fs.rmSync(outElectronExe);
fs.copyFileSync(path.join(electronSourceDir, 'electron.exe'), outElectronExe);

// Brand Electron runtime executable with AI Pharmacy OS icon and PE metadata
const rceditPath = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
const appIconPath = path.join(root, 'packaging', 'app.ico');
if (fs.existsSync(rceditPath) && fs.existsSync(appIconPath)) {
  try {
    console.log('[build-sea] Branding PharmacyOS.exe with application icon and metadata...');
    execSync(
      `"${rceditPath}" "${outElectronExe}" --set-icon "${appIconPath}" --set-version-string "FileDescription" "AI Pharmacy OS" --set-version-string "ProductName" "AI Pharmacy OS" --set-version-string "CompanyName" "AI Pharmacy Team"`,
      { stdio: 'inherit' }
    );
    console.log('[build-sea] ✓ PharmacyOS.exe branded successfully.');
  } catch (err) {
    console.warn('[build-sea] Warning: Failed to brand PharmacyOS.exe with rcedit:', err.message);
  }
}

// Prepare resources/app folder
const appResourcesDir = path.join(distDir, 'resources', 'app');
fs.mkdirSync(appResourcesDir, { recursive: true });
fs.writeFileSync(
  path.join(appResourcesDir, 'package.json'),
  JSON.stringify({ name: 'ai-pharmacy-os', version: APP_VERSION, main: 'main.cjs' }, null, 2)
);
fs.copyFileSync(path.join(electronDistDir, 'main.cjs'), path.join(appResourcesDir, 'main.cjs'));
fs.copyFileSync(path.join(electronDistDir, 'preload.cjs'), path.join(appResourcesDir, 'preload.cjs'));
console.log('[build-sea] ✓ Electron app and resources staged in dist/resources/app');

// Automatically check for Inno Setup compiler (ISCC.exe) and compile installer if installed
const isccCandidates = [
  'iscc',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 7\\ISCC.exe'
];

let isccExe = null;
for (const cand of isccCandidates) {
  try {
    if (cand === 'iscc') {
      execSync('iscc /?', { stdio: 'ignore' });
      isccExe = 'iscc';
      break;
    } else if (fs.existsSync(cand)) {
      isccExe = cand;
      break;
    }
  } catch (err) {
    // try next
  }
}

const issPath = path.join(root, 'installer.iss');
if (isccExe && fs.existsSync(issPath)) {
  // Ensure no local product images are accidentally included in the build distribution
  const distProductsDir = path.join(root, 'frontend', 'dist', 'products');
  if (fs.existsSync(distProductsDir)) {
    console.log('[build-sea] Stripping local product images from build distribution (images load via web)...');
    try {
      fs.rmSync(distProductsDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log('[build-sea] Found Inno Setup compiler! Building standalone installer setup package...');
  console.log(`[build-sea] Injecting version: ${APP_VERSION} (from package.json)`);
  try {
    // Pass version via /DMyAppVersion= so installer.iss never needs manual edits (PRODUCTION.md §6)
    execSync(`"${isccExe}" /DMyAppVersion=${APP_VERSION} "${issPath}"`, { cwd: root, stdio: 'inherit' });
    console.log(`[build-sea] 🎉 Standalone Installer created at: dist\\installer\\AI-Pharmacy-OS-Portable-Setup-v${APP_VERSION}.exe`);
  } catch (e) {
    console.error('[build-sea] Inno Setup compilation failed:', e.message);
  }
} else {
  console.log('[build-sea] Notice: Inno Setup compiler (ISCC.exe) was not found in standard paths.');
  console.log('[build-sea] If you want a 1-file setup installer, download Inno Setup (https://jrsoftware.org/isinfo.php)');
}
