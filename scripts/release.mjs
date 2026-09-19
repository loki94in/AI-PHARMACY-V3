#!/usr/bin/env node
/**
 * AI Pharmacy OS — Automated 1-Click Release & Rollout Script
 * PRODUCTION.md §19, §20, §30, §38
 *
 * Usage:
 *   npm run release            → Builds, uploads to GitHub, rolls out to ALL licensed PCs
 *   npm run release:pilot      → Builds, uploads to GitHub, rolls out ONLY to Pilot/Test PCs
 *   npm run release -- --promote  → Promotes existing PILOT release to ALL (no rebuild)
 *   npm run release -- --skip-build  → Skips build, uses existing dist artifacts
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir   = process.cwd();
const pkgPath   = path.join(rootDir, 'package.json');
const pkg       = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// ── Parse CLI flags ─────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const isPilot    = args.includes('--pilot')  || args.includes('-p');
const isPromote  = args.includes('--promote');
const skipBuild  = args.includes('--skip-build');
const bumpMajor  = args.includes('--major');
const bumpMinor  = args.includes('--minor');

// Check for remote publish (owner preference 2026-09-18: local by default unless BOTH "git" and "vercel" are specified)
const isRemote   = (args.includes('--remote') || args.includes('--publish') || (args.includes('git') && args.includes('vercel')));

// ── Vercel / GitHub config ───────────────────────────────────────────────────
const vercelServer = process.env.LICENSE_SERVER_URL || 'https://ai-pharmacy-license.vercel.app';
const adminSecret  = process.env.ADMIN_SECRET;
if ((isPromote || isRemote) && !adminSecret) {
  console.error('\n❌ STOP RELEASE: Missing required ADMIN_SECRET environment variable.');
  console.error('   Please set ADMIN_SECRET in your environment before running remote release.');
  process.exit(1);
}
const ghRepo       = 'loki94in/AI-PHARMACY-V3';

// ══════════════════════════════════════════════════════════════════════════════
// PROMOTE MODE: re-publish existing Pilot version to ALL — no rebuild needed
// PRODUCTION.md §18
// ══════════════════════════════════════════════════════════════════════════════
if (isPromote) {
  const currentVersion = pkg.version;
  const tagName        = `v${currentVersion}`;
  console.log('\n=============================================================');
  console.log(`🚀  AI Pharmacy OS — Promote Pilot → Production`);
  console.log(`📌  Version: ${tagName}`);
  console.log('=============================================================\n');

  // Verify current update server still reports this version
  console.log('🔎 Verifying update server has this version...');
  try {
    const check = await axios.get(`${vercelServer}/api/updates?action=check`, {
      params: { version: '0.0.0' },
      timeout: 10000,
    });
    if (check.data.latestVersion !== currentVersion) {
      console.error(`\n❌ Server reports latestVersion="${check.data.latestVersion}", expected "${currentVersion}".`);
      console.error('   Run npm run release:pilot first to publish this version, then promote.');
      process.exit(1);
    }
    console.log(`✓ Server has v${currentVersion}. Changing rolloutMode PILOT → ALL...`);
  } catch (err) {
    console.error('\n❌ Could not reach update server:', err.message);
    process.exit(1);
  }

  // Read manifest for downloadUrl / sha256
  const manifestPath = path.join(rootDir, 'dist', 'installer', 'update-manifest.json');
  let downloadUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/AI-Pharmacy-OS-Portable-Setup-${tagName}.exe`;
  let updatePackageUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/AI-Pharmacy-OS-Update-${tagName}.zip`;
  let sha256 = '';
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    sha256 = manifest.sha256 || '';
  }

  try {
    await axios.post(`${vercelServer}/api/updates?action=publish`, {
      latestVersion:    currentVersion,
      downloadUrl,
      updatePackageUrl,
      sha256,
      changelog:        `AI Pharmacy OS ${tagName} — Production Rollout`,
      rolloutMode:      'ALL',
      releaseType:      'production',
      releaseDate:      new Date().toISOString(),
      mandatory:        false,
    }, {
      headers: { 'x-admin-secret': adminSecret },
      timeout: 10000,
    });
  } catch (err) {
    console.error('\n❌ Promote publish to Vercel/KV FAILED — release is NOT live:', err?.response?.data || err.message);
    process.exit(1);
  }

  // Re-verify
  const verify = await axios.get(`${vercelServer}/api/updates?action=check`, {
    params: { version: '0.0.0' },
    timeout: 10000,
  });
  if (verify.data.latestVersion !== currentVersion) {
    console.error(`\n❌ Post-promote verification FAILED: server reports "${verify.data.latestVersion}".`);
    process.exit(1);
  }

  console.log('\n=============================================================');
  console.log(`🎉  PROMOTED: v${currentVersion} is now rolling out to ALL customers.`);
  console.log('=============================================================\n');
  process.exit(0);
}

// ══════════════════════════════════════════════════════════════════════════════
// NORMAL RELEASE FLOW
// ══════════════════════════════════════════════════════════════════════════════

let version;
if (isRemote) {
  // ── Auto-bump version (patch by default) ────────────────────────────────────
  const [major, minor, patch] = (pkg.version || '0.1.0').split('.').map(Number);
  let newVersion;
  if (bumpMajor)      newVersion = `${major + 1}.0.0`;
  else if (bumpMinor) newVersion = `${major}.${minor + 1}.0`;
  else                newVersion = `${major}.${minor}.${patch + 1}`;

  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`\n📝 Version bumped: ${major}.${minor}.${patch} → ${newVersion}`);
  version = newVersion;
} else {
  version = pkg.version || '0.1.0';
  console.log(`\n📦 Local Release Mode (Owner preference: skipping version bump & remote publish)`);
  console.log(`📌 Using current version: v${version}`);
}

const tagName   = `v${version}`;
const rollout   = isPilot ? 'PILOT' : 'ALL';

console.log('\n=============================================================');
console.log(`🚀  AI Pharmacy OS — Release ${isRemote ? 'Publisher' : 'Builder'} (${tagName})`);
console.log(`🎯  Rollout Target: ${isPilot ? 'PILOT ONLY (Only test/pilot licensed PCs)' : 'ALL (Production — all customers)'}`);
console.log(`🌐  Mode: ${isRemote ? 'REMOTE (GitHub + Vercel)' : 'LOCAL ONLY (Installer & Update Package)'}`);
console.log('=============================================================\n');

// ── Paths ───────────────────────────────────────────────────────────────────
const installerDir = path.join(rootDir, 'dist', 'installer');

// ── Step 1: Build ────────────────────────────────────────────────────────────
if (!skipBuild) {
  console.log('📦 Step 1: Building application (npm run build:exe)...');
  execSync('npm run build:exe', { stdio: 'inherit', cwd: rootDir });
} else {
  console.log('📦 Step 1: Skipping build (--skip-build).');
}

// ── Step 2: Locate installer — must contain the bumped version ──────────────
console.log('\n🔍 Step 2: Locating versioned installer...');
const expectedInstallerName = `AI-Pharmacy-OS-Portable-Setup-${tagName}.exe`;
const installerExe = path.join(installerDir, expectedInstallerName);

if (!fs.existsSync(installerExe)) {
  // List what's actually there for diagnostics
  const found = fs.existsSync(installerDir) ? fs.readdirSync(installerDir) : [];
  console.error(`\n❌ STOP BUILD: Versioned installer not found: ${expectedInstallerName}`);
  console.error(`   Expected: ${installerExe}`);
  console.error(`   Found in dist/installer: ${found.join(', ') || '(empty)'}`);
  console.error('   This prevents a stale installer from being released. Fix the build and retry.');
  process.exit(1);
}
console.log(`✓ Installer: ${expectedInstallerName}`);

// ── Step 3: Build update package + SHA-256 ──────────────────────────────────
console.log('\n📦 Step 3: Building update package...');
let updateManifest;
try {
  const { buildUpdatePackage } = await import('./build-update-package.mjs');
  updateManifest = await buildUpdatePackage();
} catch (pkgErr) {
  console.error('\n❌ STOP BUILD: Update package creation failed:', pkgErr.message);
  process.exit(1);
}

const updateZipPath = updateManifest.zipPath;
const sha256        = updateManifest.sha256;
const expectedZipName = `AI-Pharmacy-OS-Update-${tagName}.zip`;

if (!fs.existsSync(updateZipPath)) {
  console.error(`\n❌ STOP BUILD: Update zip not found after build: ${updateZipPath}`);
  process.exit(1);
}
console.log(`✓ Update ZIP: ${expectedZipName}`);
console.log(`✓ SHA-256: ${sha256}`);

// ── Local Mode Exit ──────────────────────────────────────────────────────────
if (!isRemote) {
  console.log('\n=============================================================');
  console.log('🎉  LOCAL RELEASE BUILD COMPLETED & VERIFIED!');
  console.log(`    Version  : ${version}`);
  console.log(`    Rollout  : ${rollout}`);
  console.log(`    Installer: ${installerExe}`);
  console.log(`    Update   : ${updateZipPath}`);
  console.log(`    SHA-256  : ${sha256}`);
  console.log('\n💡  To publish to GitHub & Vercel, include both "git" and "vercel":');
  console.log('    npm release git vercel');
  console.log('=============================================================\n');
  process.exit(0);
}

// ── Step 4: Upload to GitHub Releases ───────────────────────────────────────
console.log('\n📤 Step 4: Uploading assets to GitHub Releases...');

const downloadUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/${expectedInstallerName}`;
const updatePackageUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/${expectedZipName}`;

try {
  let releaseExists = false;
  try {
    execSync(`gh release view ${tagName}`, { stdio: 'ignore' });
    releaseExists = true;
  } catch (_) {}

  if (releaseExists) {
    console.log(`   Release ${tagName} already exists. Updating assets (--clobber)...`);
    execSync(`gh release upload ${tagName} "${installerExe}" --clobber`, { stdio: 'inherit', cwd: rootDir });
    execSync(`gh release upload ${tagName} "${updateZipPath}" --clobber`, { stdio: 'inherit', cwd: rootDir });
  } else {
    console.log(`   Creating new GitHub release ${tagName}...`);
    const notes = isPilot
      ? `AI Pharmacy OS ${tagName} — Pilot / Staging Release`
      : `AI Pharmacy OS ${tagName} — Production Release`;
    execSync(
      `gh release create ${tagName} "${installerExe}" "${updateZipPath}" --title "AI Pharmacy OS ${tagName}" --notes "${notes}"`,
      { stdio: 'inherit', cwd: rootDir }
    );
  }
  console.log('✓ GitHub upload complete (installer + update package).');
} catch (ghErr) {
  console.error('\n❌ GitHub upload failed. Ensure `gh auth status` is authenticated:', ghErr.message);
  process.exit(1);
}

// ── Step 5: Publish metadata to Vercel/Redis ─────────────────────────────────
console.log('\n🌐 Step 5: Publishing version metadata to update server...');
console.log(`   Server       : ${vercelServer}`);
console.log(`   Version      : ${version}`);
console.log(`   Rollout      : ${rollout}`);
console.log(`   Installer URL: ${downloadUrl}`);
console.log(`   Update URL   : ${updatePackageUrl}`);
console.log(`   SHA-256      : ${sha256}`);

try {
  await axios.post(`${vercelServer}/api/updates?action=publish`, {
    latestVersion:    version,
    downloadUrl,
    updatePackageUrl,
    sha256,
    changelog:        `AI Pharmacy OS ${tagName}\n• Production-stable installer\n• Auto background update\n• Safe updater with rollback`,
    rolloutMode:      rollout,
    releaseType:      isPilot ? 'pilot' : 'production',
    releaseDate:      new Date().toISOString(),
    mandatory:        false,
  }, {
    headers: { 'x-admin-secret': adminSecret },
    timeout: 10000,
  });
} catch (publishErr) {
  // PRODUCTION.md §20 — GitHub asset uploaded but update server NOT published → RELEASE NOT LIVE
  console.error('\n❌ RELEASE NOT LIVE: Publish to Vercel/KV FAILED — no PC will detect this update.');
  console.error('   GitHub assets ARE uploaded. The update-check server was NOT updated.');
  console.error('   Reason:', publishErr?.response?.data || publishErr.message);
  console.error(`   Installer URL: ${downloadUrl}`);
  console.error('   Fix ADMIN_SECRET / LICENSE_SERVER_URL and re-run with --skip-build, or publish manually.');
  process.exit(1);
}

// ── Step 6: Verify server now reports the new version ───────────────────────
console.log('\n🔎 Step 6: Verifying update server reports new version...');
try {
  const verify = await axios.get(`${vercelServer}/api/updates?action=check`, {
    params: { version: '0.0.0' },
    timeout: 10000,
  });
  if (verify.data.latestVersion !== version) {
    console.error(`\n❌ Verification FAILED: server reports latestVersion="${verify.data.latestVersion}", expected "${version}".`);
    console.error('   PCs will keep reporting "up to date" on the OLD version. Do not consider this release done.');
    process.exit(1);
  }
  console.log(`✓ Server confirmed: latestVersion="${verify.data.latestVersion}".`);
} catch (verifyErr) {
  console.error('\n❌ Could not verify publish — treat this release as NOT confirmed:', verifyErr?.response?.data || verifyErr.message);
  process.exit(1);
}

// ── Success summary ──────────────────────────────────────────────────────────
console.log('\n=============================================================');
console.log('🎉  RELEASE PUBLISHED & VERIFIED!');
console.log(`    Version  : ${version}`);
console.log(`    Rollout  : ${rollout}`);
console.log(`    Installer: ${downloadUrl}`);
console.log(`    Update   : ${updatePackageUrl}`);
console.log(`    SHA-256  : ${sha256}`);
if (isPilot) {
  console.log('\n🔒  Status: PILOT MODE.');
  console.log('    Only Pilot-licensed PCs will receive this update.');
  console.log('    All other customers stay on their current version.');
  console.log(`    Once tested, run: npm run release -- --promote`);
  console.log('    (promotes the EXACT same build to ALL — no rebuild)');
} else {
  console.log('\n🌍  Status: PRODUCTION MODE.');
  console.log('    Every licensed PC will auto-detect and safely update.');
}
console.log('=============================================================\n');
