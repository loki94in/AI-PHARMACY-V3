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

export async function buildUpdatePackage() {
  console.log(`\n[UpdatePackage] Building update package for v${version}...`);

  // Preflight checks
  for (const { src, zipEntry } of UPDATE_SOURCES) {
    if (!fs.existsSync(src)) {
      throw new Error(`[UpdatePackage] Required file missing: ${src} (needed for ${zipEntry})`);
    }
  }
  if (!fs.existsSync(frontendDist)) {
    throw new Error(`[UpdatePackage] frontend/dist not found at: ${frontendDist}`);
  }

  fs.mkdirSync(installerDir, { recursive: true });

  // Remove stale zip if exists
  if (fs.existsSync(zipOutPath)) {
    fs.rmSync(zipOutPath);
    console.log(`[UpdatePackage] Removed stale zip: ${zipName}`);
  }

  const zip = new AdmZip();

  // Add individual files
  for (const { src, zipEntry } of UPDATE_SOURCES) {
    console.log(`[UpdatePackage]   + ${zipEntry}`);
    zip.addLocalFile(src, '', zipEntry);
  }

  // Add frontend/dist recursively, exclude product images (per installer spec — images load via web)
  function addDirToZip(dirPath, zipBasePath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const entryZipDir = zipBasePath || '';
      if (entry.isDirectory()) {
        // Skip product images directory
        if (entry.name === 'products' && zipBasePath === 'frontend/dist') continue;
        addDirToZip(fullPath, `${entryZipDir}${entry.name}/`);
      } else {
        zip.addLocalFile(fullPath, entryZipDir, entry.name);
      }
    }
  }

  console.log(`[UpdatePackage]   + frontend/dist/**`);
  addDirToZip(frontendDist, 'frontend/dist/');

  // Write zip
  zip.writeZip(zipOutPath);
  console.log(`[UpdatePackage] ZIP created: ${zipName}`);

  // Calculate SHA-256
  const sha256 = await computeSha256(zipOutPath);
  console.log(`[UpdatePackage] SHA-256: ${sha256}`);

  // Write manifest for release.mjs to consume
  const manifest = {
    version,
    zipName,
    zipPath: zipOutPath,
    sha256,
    createdAt: new Date().toISOString(),
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
