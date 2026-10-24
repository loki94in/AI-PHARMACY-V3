#!/usr/bin/env node
/**
 * build-update-package.mjs
 *
 * Creates an update ZIP package and its SHA-256 checksum for a given release.
 * Called by scripts/release.mjs during the release pipeline.
 *
 * Output:
 *   dist/installer/AI-Pharmacy-OS-Update-vX.Y.Z.zip
 *   dist/installer/update-manifest.json   (sha256, version, paths)
 *
 * PRODUCTION.md §21, §31
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// ── Version ────────────────────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

// ── Paths ──────────────────────────────────────────────────────────────────
const distDir       = path.join(root, 'dist');
const installerDir  = path.join(distDir, 'installer');
const zipName       = `AI-Pharmacy-OS-Update-v${version}.zip`;
const zipOutPath    = path.join(installerDir, zipName);
const manifestPath  = path.join(installerDir, 'update-manifest.json');

// Files included in the update package (runtime replacement files only).
// User data (data/, uploads/, backup/, .env, license state) is NEVER in the zip.
const UPDATE_SOURCES = [
  { src: path.join(distDir, 'PharmacyOS.exe'),        zipEntry: 'PharmacyOS.exe' },
  { src: path.join(root, 'sea-entry.cjs'),             zipEntry: 'sea-entry.cjs' },
  { src: path.join(root, 'packaging', 'Updater.bat'),  zipEntry: 'Updater.bat' },
];

// frontend/dist directory (recursive)
const frontendDist = path.join(root, 'frontend', 'dist');
const resourcesAppDir = path.join(distDir, 'resources', 'app');

function buildWithArchiver(sources, manifestTempPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipOutPath);
    const hash = crypto.createHash('sha256');
    const archive = archiver('zip', {
      zlib: { level: 6 }
    });

    output.on('close', () => {
      resolve(hash.digest('hex'));
    });
    archive.on('error', reject);
    output.on('error', reject);

    archive.on('data', chunk => hash.update(chunk));
    archive.pipe(output);

    for (const { src, zipEntry } of sources) {
      console.log(`[UpdatePackage]   + ${zipEntry}`);
      archive.file(src, { name: zipEntry });
    }

    if (manifestTempPath && fs.existsSync(manifestTempPath)) {
      console.log(`[UpdatePackage]   + update-manifest.json`);
      archive.file(manifestTempPath, { name: 'update-manifest.json' });
    }

    if (fs.existsSync(resourcesAppDir)) {
      console.log(`[UpdatePackage]   + resources/app/**`);
      archive.directory(resourcesAppDir, 'resources/app');
    }

    console.log(`[UpdatePackage]   + frontend/dist/**`);
    archive.directory(frontendDist, 'frontend/dist', entry => {
      const normalized = (entry.name || '').replace(/\\/g, '/');
      if (normalized === 'frontend/dist/products' ||
          normalized.startsWith('frontend/dist/products/') ||
          normalized.includes('/products/') ||
          normalized.startsWith('products/')) {
        return false;
      }
      return entry;
    });

    archive.finalize();
  });
}

async function buildWithAdmZip(sources, manifestTempPath) {
  const zip = new AdmZip();
  for (const { src, zipEntry } of sources) {
    console.log(`[UpdatePackage]   + ${zipEntry}`);
    zip.addLocalFile(src, '', zipEntry);
  }

  if (manifestTempPath && fs.existsSync(manifestTempPath)) {
    console.log(`[UpdatePackage]   + update-manifest.json`);
    zip.addLocalFile(manifestTempPath, '', 'update-manifest.json');
  }

  function addDirToZip(dirPath, zipBasePath, excludeFilter) {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const entryZipDir = zipBasePath || '';
      if (entry.isDirectory()) {
        if (excludeFilter && excludeFilter(entry.name)) continue;
        addDirToZip(fullPath, `${entryZipDir}${entry.name}/`, excludeFilter);
      } else {
        zip.addLocalFile(fullPath, entryZipDir, entry.name);
      }
    }
  }

  if (fs.existsSync(resourcesAppDir)) {
    console.log(`[UpdatePackage]   + resources/app/**`);
    addDirToZip(resourcesAppDir, 'resources/app/');
  }

  addDirToZip(frontendDist, 'frontend/dist/', (name) => name === 'products');
  zip.writeZip(zipOutPath);
  return await computeSha256(zipOutPath);
}

export async function buildUpdatePackage() {
  console.log(`\n[UpdatePackage] Building update package for v${version}...`);

  fs.mkdirSync(installerDir, { recursive: true });

  if (!fs.existsSync(frontendDist)) {
    throw new Error(`[UpdatePackage] frontend/dist not found at: ${frontendDist}`);
  }

  // Load previous manifest to determine differential bundling
  let prevManifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      prevManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {}
  }

  const forceFull = Boolean(process.env.FORCE_FULL_UPDATE || process.argv.includes('--full-update'));
  const fileManifest = {};
  const updateSources = [
    { src: path.join(root, 'sea-entry.cjs'), zipEntry: 'sea-entry.cjs' },
    { src: path.join(root, 'packaging', 'Updater.bat'), zipEntry: 'Updater.bat' },
  ];

  // 1. Electron runtime executable (PharmacyOS.exe - 235 MB)
  const pharmacyOsPath = path.join(distDir, 'PharmacyOS.exe');
  if (fs.existsSync(pharmacyOsPath)) {
    const osSha = await computeSha256(pharmacyOsPath);
    const osSize = fs.statSync(pharmacyOsPath).size;
    const prevSha = prevManifest?.files?.['PharmacyOS.exe']?.sha256;
    const isUnchanged = prevSha && prevSha.toLowerCase() === osSha.toLowerCase();

    if (isUnchanged && !forceFull) {
      console.log(`[UpdatePackage] PharmacyOS.exe (${(osSize / (1024 * 1024)).toFixed(1)} MB) is UNCHANGED vs previous release. Omitted from ZIP (saving ~100MB download).`);
      fileManifest['PharmacyOS.exe'] = { sha256: osSha, size: osSize, includedInZip: false };
    } else {
      console.log(`[UpdatePackage] Including PharmacyOS.exe (${(osSize / (1024 * 1024)).toFixed(1)} MB) in ZIP...`);
      updateSources.push({ src: pharmacyOsPath, zipEntry: 'PharmacyOS.exe' });
      fileManifest['PharmacyOS.exe'] = { sha256: osSha, size: osSize, includedInZip: true };
    }
  }

  // 2. Node SEA backend executable (PharmacyBackend.exe)
  const backendExePath = path.join(distDir, 'PharmacyBackend.exe');
  if (fs.existsSync(backendExePath)) {
    const backendSha = await computeSha256(backendExePath);
    const backendSize = fs.statSync(backendExePath).size;
    updateSources.push({ src: backendExePath, zipEntry: 'PharmacyBackend.exe' });
    fileManifest['PharmacyBackend.exe'] = { sha256: backendSha, size: backendSize, includedInZip: true };
  }

  // 3. Bundled backend code (dist-pkg/server.cjs)
  const serverCjsPath = path.join(root, 'dist-pkg', 'server.cjs');
  if (fs.existsSync(serverCjsPath)) {
    const serverSha = await computeSha256(serverCjsPath);
    const serverSize = fs.statSync(serverCjsPath).size;
    updateSources.push({ src: serverCjsPath, zipEntry: 'dist-pkg/server.cjs' });
    fileManifest['dist-pkg/server.cjs'] = { sha256: serverSha, size: serverSize, includedInZip: true };
  }

  // Preflight check for core files
  for (const { src, zipEntry } of updateSources) {
    if (!fs.existsSync(src)) {
      throw new Error(`[UpdatePackage] Required file missing: ${src} (needed for ${zipEntry})`);
    }
  }

  // Remove stale zip if exists
  if (fs.existsSync(zipOutPath)) {
    fs.rmSync(zipOutPath);
    console.log(`[UpdatePackage] Removed stale zip: ${zipName}`);
  }

  // Write temporary manifest to include inside the ZIP
  const tempManifestPath = path.join(installerDir, 'update-manifest.tmp.json');
  const interimManifest = {
    version,
    zipName,
    createdAt: new Date().toISOString(),
    files: fileManifest,
  };
  fs.writeFileSync(tempManifestPath, JSON.stringify(interimManifest, null, 2) + '\n', 'utf8');

  let sha256;
  try {
    // Fast streaming zip creation with fused SHA-256
    sha256 = await buildWithArchiver(updateSources, tempManifestPath);
    console.log(`[UpdatePackage] ZIP created (archiver stream): ${zipName}`);
  } catch (streamErr) {
    console.warn(`[UpdatePackage] Streaming zip failed (${streamErr.message}), falling back to AdmZip...`);
    sha256 = await buildWithAdmZip(updateSources, tempManifestPath);
    console.log(`[UpdatePackage] ZIP created (AdmZip fallback): ${zipName}`);
  }

  try { fs.unlinkSync(tempManifestPath); } catch (_) {}

  console.log(`[UpdatePackage] SHA-256: ${sha256}`);

  // Write final manifest for release.mjs and autoUpdateService to consume
  const manifest = {
    version,
    zipName,
    zipPath: zipOutPath,
    sha256,
    createdAt: new Date().toISOString(),
    files: fileManifest,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[UpdatePackage] Manifest written: update-manifest.json`);

  return manifest;
}

function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Allow running directly: node scripts/build-update-package.mjs
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  buildUpdatePackage()
    .then(m => {
      console.log('\n[UpdatePackage] ✅ Done.');
      console.log(`  ZIP:    ${m.zipName}`);
      console.log(`  SHA256: ${m.sha256}`);
    })
    .catch(err => {
      console.error('\n[UpdatePackage] ❌ Failed:', err.message);
      process.exit(1);
    });
}
